import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeSiteUrl } from '@/lib/entitlements';
import { enqueueScanIfNeeded } from '@/lib/scan-trigger';
import { claimAndRunScanJob } from '@/lib/scan-worker';
import type { Customer, Website } from '@prisma/client';
import { computeOutcomesSummary } from '@/lib/dashboard-stats';
import { parseCommandBarIntent } from '@/lib/command-bar/intent-router';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';

export interface CommandBarAction {
  label: string;
  href: string;
}

export interface CommandBarResponse {
  message: string;
  context: { websiteUrl: string; gscConnected: boolean };
  actions: CommandBarAction[];
}

// Explicit allowlist: every branch below calls only existing, already-
// authorized read/write functions scoped to this customer's own website.
// There is no code path from `text` to a shell command, a raw SQL string,
// or an arbitrary tool call. parseCommandBarIntent returns fixed shapes;
// stored scan logs and guard reasoning are display text, never router input.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const { text, websiteId } = await req.json();
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  let customer, website;
  try {
    ({ customer, website } = await resolveWebsiteForRequest(userId, typeof websiteId === 'string' ? websiteId : undefined));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  const context = { websiteUrl: website.url, gscConnected: Boolean(website.gscRefreshToken) };
  const intent = parseCommandBarIntent(text);
  const body: CommandBarResponse = await handleIntent(intent, customer.id, website, context);

  return NextResponse.json(body);
}

async function handleIntent(
  intent: ReturnType<typeof parseCommandBarIntent>,
  customerId: string,
  website: { id: string; url: string; gscRefreshToken: string | null },
  context: CommandBarResponse['context']
): Promise<CommandBarResponse> {
  switch (intent.type) {
    case 'run_audit': {
      if (website.url === PENDING_WEBSITE_URL) {
        return {
          message: "Confirm this website's URL in Settings before running an audit.",
          context,
          actions: [{ label: 'Go to Settings', href: '/settings' }],
        };
      }
      if (intent.pastedUrl && normalizeSiteUrl(intent.pastedUrl) !== normalizeSiteUrl(website.url)) {
        return {
          message: `Dex currently audits your connected site (${website.url}) only — it doesn't scan arbitrary URLs yet. Say "audit" with nothing else to check your connected site.`,
          context,
          actions: [],
        };
      }
      const { enqueued, jobId } = await enqueueScanIfNeeded(customerId, website as never);
      if (enqueued) {
        // Same reasoning as /api/scan: no cron sweeps queued jobs frequently
        // enough for a responsive "audit" command, so run it inline here too.
        await claimAndRunScanJob({
          id: jobId,
          customer: { id: customerId } as unknown as Customer,
          website: website as unknown as Website,
        });
      }
      return {
        message: enqueued
          ? `Started an audit of ${website.url}. Watch progress in the Overview tab.`
          : 'An audit is already running or queued for this site.',
        context,
        actions: [{ label: 'View scan status', href: `/dashboard/${website.id}?tab=overview` }],
      };
    }

    case 'list_pending': {
      const count = await db.action.count({ where: { websiteId: website.id, status: 'pending' } });
      return {
        message:
          count === 0
            ? 'Nothing pending review right now.'
            : `${count} change${count === 1 ? '' : 's'} waiting for your review.`,
        context,
        actions: [{ label: 'Open Review Queue', href: `/dashboard/${website.id}?tab=review` }],
      };
    }

    case 'list_outcomes': {
      const actions = await db.action.findMany({
        where: { websiteId: website.id },
        select: { outcomeMeasuredAt: true, baselinePerformance: true, outcomePerformance: true },
      });
      const summary = computeOutcomesSummary(actions);
      return {
        message:
          summary.measuredCount === 0
            ? 'No measured outcomes yet — results appear 28 days after an approved change.'
            : `${summary.winCount} of ${summary.measuredCount} measured changes improved clicks.`,
        context,
        actions: [{ label: 'Open Outcomes', href: `/dashboard/${website.id}?tab=outcomes` }],
      };
    }

    case 'scan_report': {
      const scan = await db.scanJob.findFirst({
        where: { websiteId: website.id },
        orderBy: { createdAt: 'desc' },
        include: { logLines: { orderBy: { createdAt: 'desc' }, take: 3 } },
      });
      if (!scan) {
        return {
          message: 'No scans have run for this site yet.',
          context,
          actions: [{ label: 'Run an audit', href: `/dashboard/${website.id}` }],
        };
      }
      const lastLine = scan.logLines[0]?.message.slice(0, 200);
      return {
        message: lastLine
          ? `Latest scan is ${scan.status}. Last log line: "${lastLine}"`
          : `Latest scan is ${scan.status}.`,
        context,
        actions: [{ label: 'View scan status', href: `/dashboard/${website.id}?tab=overview` }],
      };
    }

    case 'show_evidence': {
      const action = await db.action.findFirst({
        where: { websiteId: website.id, status: 'pending' },
        orderBy: { createdAt: 'asc' },
        include: { guardResult: true },
      });
      if (!action) {
        return { message: 'No finding is selected, and nothing is pending to explain.', context, actions: [] };
      }
      const outcomeText = action.guardResult
        ? ` ProofLayer outcome: ${action.guardResult.outcome}. ${action.guardResult.reasoning.slice(0, 200)}`
        : ' ProofLayer has not run on this one yet.';
      return {
        message: `No finding is selected. The oldest pending change is ${action.actionType} on ${action.pageUrl}.${outcomeText}`,
        context,
        actions: [{ label: 'Open in Review', href: `/review/${action.id}` }],
      };
    }

    case 'list_blocked': {
      const count = await db.action.count({
        where: {
          websiteId: website.id,
          status: 'pending',
          OR: [{ generationStatus: 'failed' }, { guardResult: { outcome: { in: ['flag', 'block'] } } }],
        },
      });
      return {
        message: count === 0
          ? 'No pending items need attention right now.'
          : `${count} pending item${count === 1 ? ' needs' : 's need'} attention (failed draft or ProofLayer flag/block).`,
        context,
        actions: [{ label: 'Open Review Queue', href: '/review' }],
      };
    }

    case 'request_content': {
      const params = new URLSearchParams();
      if (intent.platform) params.set('platform', intent.platform);
      if (intent.topic) params.set('topic', intent.topic);
      const query = params.toString();
      return {
        message: intent.platform
          ? `Opening Content Studio to draft a ${intent.platform} post${intent.topic ? ` about ${intent.topic}` : ''}.`
          : 'Opening Content Studio.',
        context,
        actions: [{ label: 'Open Content Studio', href: `/studio${query ? `?${query}` : ''}` }],
      };
    }

    case 'help':
    default:
      return {
        message: 'I can run an audit, list pending drafts, or summarize measured outcomes. Try "audit", "pending", or "outcomes".',
        context,
        actions: [],
      };
  }
}
