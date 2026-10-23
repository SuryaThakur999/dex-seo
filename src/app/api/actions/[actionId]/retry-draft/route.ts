import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchPageMeta, fetchHtml, parsePageMeta } from '@/lib/crawler';
import type { Action, Website } from '@prisma/client';
import { checkRestrictedWording } from '@/lib/audit-agents/brand-specialist';
import { getCustomerSafeGenerationError } from '@/lib/customer-safe-error';
import { RESTRICTED_WORDING_FIX_ACTION_TYPE } from '@/lib/restricted-wording-fix';
import { INTERNAL_LINK_FIX_ACTION_TYPE } from '@/lib/internal-link-fix';
import { enqueueGenerationJob, claimAndRunGenerationJob, type GenerationOutcomeStatus } from '@/lib/generation-worker';
import { metaDescriptionFingerprint, restrictedWordingFixFingerprint } from '@/lib/generation-payload';

type RetriableAction = Pick<Action, 'id' | 'actionType' | 'pageUrl'>;
type RetriableWebsite = Pick<Website, 'id' | 'clientProfileId' | 'autoExecuteEnabled'>;

// A manual retry click enqueues+immediately runs a GenerationJob exactly like run-scan.ts's own
// call sites (Phase 1C, docs/superpowers/specs/2026-09-28-phase1c-generation-queue-adr.md) --
// the job's success path already resolves to THIS SAME Action row (it looks up an existing
// pending/failed Action for this customer+website+pageUrl+actionType, which this route already
// confirmed exists before calling in), so no separate Action-write path is needed here.
async function retryMetaDescription(action: RetriableAction, website: RetriableWebsite, customerId: string): Promise<GenerationOutcomeStatus> {
  const meta = await fetchPageMeta(action.pageUrl);
  if (!meta.title && !meta.h1 && !meta.metaDescription) {
    throw new Error(`Couldn't read ${action.pageUrl} — it may be unreachable or blocking crawlers.`);
  }

  const { id: jobId } = await enqueueGenerationJob({
    customerId,
    websiteId: website.id,
    actionType: 'meta_description',
    targetRef: action.pageUrl,
    inputFingerprint: metaDescriptionFingerprint(meta),
    payload: { actionType: 'meta_description', url: action.pageUrl, title: meta.title, metaDescription: meta.metaDescription, h1: meta.h1, findingId: null },
  });
  const result = await claimAndRunGenerationJob(jobId);
  return result.outcome ?? 'failed';
}

// Re-checks the page fresh (not just re-uses the stale matches from the original failed attempt)
// — the same phrase may no longer be present (customer edited the page, or the restricted-wording
// list itself changed since the original scan), and re-drafting against stale evidence would be
// dishonest. If nothing matches anymore, this throws a real, specific error rather than silently
// drafting nothing.
async function retryRestrictedWordingFix(action: RetriableAction, website: RetriableWebsite, customerId: string): Promise<GenerationOutcomeStatus> {
  const html = await fetchHtml(action.pageUrl);
  if (!html) {
    throw new Error(`Couldn't read ${action.pageUrl} — it may be unreachable or blocking crawlers.`);
  }

  const clientProfile = await db.clientProfile.findUnique({
    where: { id: website.clientProfileId },
    select: { restrictedWording: true },
  });
  const restrictedWording = clientProfile?.restrictedWording ?? [];

  const findings = checkRestrictedWording(action.pageUrl, html, restrictedWording);
  const matches = (findings[0]?.evidence as { matches: { phrase: string; excerpt: string }[] } | undefined)?.matches ?? [];
  if (matches.length === 0) {
    throw new Error(`${action.pageUrl} no longer contains the restricted wording this fix was for.`);
  }

  const meta = parsePageMeta(html);

  const { id: jobId } = await enqueueGenerationJob({
    customerId,
    websiteId: website.id,
    actionType: RESTRICTED_WORDING_FIX_ACTION_TYPE,
    targetRef: action.pageUrl,
    inputFingerprint: restrictedWordingFixFingerprint(matches),
    // This re-derives matches fresh (see comment above) rather than reading a stored Finding,
    // so there's no real Finding id in hand here -- same honest `null` as meta_description.
    payload: { actionType: 'restricted_wording_fix', pageUrl: action.pageUrl, matches, title: meta.title, metaDescription: meta.metaDescription, findingId: null },
  });
  const result = await claimAndRunGenerationJob(jobId);
  return result.outcome ?? 'failed';
}

// Re-attempts draft generation for a finding whose earlier attempt failed. Reuses each
// actionType's own real drafting pipeline against the same Action row, rather than creating a
// second finding for the same page. Dispatches by actionType — a fixed-actionType assumption
// here would silently draft the WRONG content type for any non-meta_description Action.
export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId } });
  if (!action || action.customerId !== customer.id) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 });
  }
  if (action.status !== 'pending' || action.generationStatus !== 'failed') {
    return NextResponse.json({ error: 'This finding is not retriable' }, { status: 400 });
  }

  const website = await db.website.findUnique({ where: { id: action.websiteId } });
  if (!website) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

  try {
    let outcome: GenerationOutcomeStatus;
    if (action.actionType === RESTRICTED_WORDING_FIX_ACTION_TYPE) {
      outcome = await retryRestrictedWordingFix(action, website, customer.id);
    } else if (action.actionType === INTERNAL_LINK_FIX_ACTION_TYPE) {
      // No real retry path yet: unlike every other actionType, this one needs the site's FULL
      // crawled page inventory (run-scan.ts's `snapshots`) to pick candidates, which this
      // single-action route has no way to reconstruct honestly. Explicitly rejecting here (never
      // falling through to retryMetaDescription, which would silently overwrite this row with a
      // wrongly-typed meta-description draft) is the safe choice -- a real fix needs its own
      // page-discovery pass, not a same-commit patch. The next scheduled scan still self-heals
      // this in place via run-scan.ts's own failedExisting-retry logic; only the manual "Retry
      // draft" button is blocked, not automatic recovery.
      throw new Error('Retry for internal-link suggestions is not available yet — the next scheduled scan will redraft this automatically.');
    } else {
      outcome = await retryMetaDescription(action, website, customer.id);
    }

    // 'completed' already wrote the succeeded draft onto this row; 'failed' (attempts
    // exhausted) already wrote a real generationError -- generation-worker.ts owns both. Only
    // the in-between states (this specific click's attempt was transient, background sweep will
    // keep retrying) need a nudge here, so the customer's redirect doesn't show a stale error
    // from whatever the *previous* failure said.
    if (outcome === 'waiting_retry' || outcome === 'rate_limited' || outcome === 'blocked') {
      await db.action.updateMany({
        where: { id: action.id, generationStatus: 'failed' },
        data: { generationError: 'Still working on this draft — check back in a minute.' },
      });
    }
  } catch (err) {
    // The real error is safe only in server logs — generationError is rendered directly to
    // the customer in action-detail.tsx (can otherwise leak a raw provider exception, e.g.
    // one naming OPENAI_API_KEY).
    console.error('Retry-draft failed for action', action.id, err);
    await db.action.updateMany({
      where: { id: action.id, generationStatus: 'failed' },
      data: { generationError: getCustomerSafeGenerationError(err) },
    });
  }

  return NextResponse.redirect(new URL(`/review/${action.id}`, req.url), 303);
}
