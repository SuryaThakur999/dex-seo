import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getPagePerformanceForRange, findObservedPagePerformance, GoogleAuthError, GoogleConfigError } from '@/lib/gsc-client';
import { buildProofReceipt, type ActionWithOwnedWebsiteAndGuard, type ReceiptEvent } from '@/lib/proof-receipt';

export const maxDuration = 60;

const WINDOW_DAYS = 28;
const REPORTING_LAG_DAYS = 3; // GSC Search Analytics data typically lags 2-3 days behind real-time

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cutoff = new Date(Date.now() - (WINDOW_DAYS + REPORTING_LAG_DAYS) * 24 * 60 * 60 * 1000);
  const candidates = await db.action.findMany({
    where: {
      status: { in: ['approved', 'edited'] },
      baselineCapturedAt: { not: null, lte: cutoff },
      outcomeMeasuredAt: null,
      website: { gscRefreshToken: { not: null }, gscReconnectRequired: false, gscPropertyUrl: { not: null } },
    },
    include: { guardResult: true, website: { include: { clientProfile: { select: { id: true, customerId: true } } } } },
  });

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let unavailable = 0;
  for (const action of candidates) {
    const baseline = action.baselinePerformance;
    if (!action.decidedAt || !baseline || typeof baseline !== 'object' || Array.isArray(baseline) ||
        !('captureVersion' in baseline) || baseline.captureVersion !== 1 || baseline.availability !== 'observed_gsc_row' ||
        typeof baseline.decisionEventId !== 'string') {
      skipped++;
      continue;
    }
    const entries = await db.auditLogEntry.findMany({
      where: { customerId: action.customerId, actionId: action.id, eventType: 'action_decided' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const events: ReceiptEvent[] = entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }));
    const receipt = buildProofReceipt({ action: action as ActionWithOwnedWebsiteAndGuard, events });
    const decisionEvent = events.find((event) => event.id === baseline.decisionEventId);
    const eventDetail = decisionEvent?.detail && typeof decisionEvent.detail === 'object' && !Array.isArray(decisionEvent.detail)
      ? decisionEvent.detail as Record<string, unknown>
      : null;
    const eventSnapshot = eventDetail?.receiptSnapshot && typeof eventDetail.receiptSnapshot === 'object' && !Array.isArray(eventDetail.receiptSnapshot)
      ? eventDetail.receiptSnapshot as Record<string, unknown>
      : null;
    if (!receipt.snapshot || !decisionEvent || receipt.snapshot.decidedAt !== action.decidedAt.toISOString() ||
        decisionEvent.createdAt !== action.decidedAt.toISOString() || receipt.snapshot.decision !== action.status ||
        eventSnapshot?.actionId !== receipt.snapshot.actionId || eventSnapshot?.customerId !== receipt.snapshot.customerId ||
        eventSnapshot?.websiteId !== receipt.snapshot.websiteId || eventSnapshot?.decision !== receipt.snapshot.decision ||
        eventSnapshot?.decidedAt !== receipt.snapshot.decidedAt || eventSnapshot?.actorClerkUserId !== receipt.snapshot.actorClerkUserId) {
      skipped++;
      continue;
    }

    try {
      const windowStart = new Date(action.baselineCapturedAt!.getTime() + 24 * 60 * 60 * 1000); // +1 day: avoid overlapping the baseline window's last day
      const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const performance = await getPagePerformanceForRange(
        decrypt(action.website.gscRefreshToken!),
        action.website.gscPropertyUrl!,
        windowStart.toISOString().slice(0, 10),
        windowEnd.toISOString().slice(0, 10)
      );
      const metrics = findObservedPagePerformance(performance, action.pageUrl);
      if (!metrics) {
        skipped++;
        unavailable++;
        continue;
      }
      const outcomeMeasuredAt = new Date();
      const result = await db.action.updateMany({
        where: {
          id: action.id,
          customerId: action.customerId,
          websiteId: action.websiteId,
          status: action.status,
          decidedAt: action.decidedAt,
          baselineCapturedAt: action.baselineCapturedAt,
          baselinePerformance: { equals: baseline as never },
          outcomeMeasuredAt: null,
        },
        data: {
          outcomePerformance: { ...metrics, captureVersion: 1, availability: 'observed_gsc_row', decisionEventId: decisionEvent.id },
          outcomeMeasuredAt,
        },
      });
      if (result.count === 1) succeeded++;
      else skipped++;
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        // Anchor on the exact ciphertext this call used — a customer who
        // reconnected mid-run must not have that success overwritten by a
        // stale failure report from the token that was already dead.
        try {
          await db.website.updateMany({
            where: { id: action.website.id, gscRefreshToken: action.website.gscRefreshToken },
            data: { gscReconnectRequired: true },
          });
        } catch (flagErr) {
          console.error(`measure-outcomes: failed to flag reconnect-required for website ${action.website.id}`, flagErr instanceof Error ? flagErr.message : flagErr);
        }
      } else if (err instanceof GoogleConfigError) {
        console.error(`measure-outcomes: OAuth client rejected for website ${action.website.id}`, err.message);
      }
      console.error(`measure-outcomes: action ${action.id} failed`, err instanceof Error ? err.message : err);
      failed++;
      unavailable++;
    }
  }

  return NextResponse.json({ processed: candidates.length, succeeded, failed, skipped, unavailable });
}
