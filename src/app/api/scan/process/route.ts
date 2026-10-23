import { NextRequest, NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';
import { db } from '@/lib/db';
import { claimAndRunScanJob } from '@/lib/scan-worker';

// Matches ../route.ts's maxDuration — a job claimed by this sweep runs the same
// runScanForCustomer crawl inline (see claimAndRunScanJob), so it needs the same runtime
// budget. Left at 60 before, a sweep-claimed job would get cut off well before a
// customer-triggered one doing identical work would.
export const maxDuration = 300;

// A job stuck in 'running' longer than this was almost certainly killed by the platform's
// function timeout mid-scan (maxDuration above) rather than ever finishing — reap it so it
// stops blocking both the dashboard status and the enqueue-dedup guard in ../route.ts.
const STALE_RUNNING_MINUTES = 10;

// Two independent, valid callers: Vercel's own cron (bearer secret, currently daily — kept as
// a free fallback even after QStash takes over the frequent sweep) and QStash's scheduled call
// (signed request, every few minutes — see docs/superpowers/specs/2026-09-24-phase1b-scan-queue-adr.md).
// Either one alone is sufficient; this route doesn't require both.
async function isAuthorizedCronCaller(req: NextRequest, rawBody: string): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return true;
  }

  const signature = req.headers.get('upstash-signature');
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signature || !currentSigningKey || !nextSigningKey) {
    return false;
  }
  try {
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    return await receiver.verify({ signature, body: rawBody });
  } catch {
    // A malformed or expired signature is a rejection, not a server error — never let a
    // verification exception leak into a 500 or bypass the check.
    return false;
  }
}

export async function GET(req: NextRequest) {
  const rawBody = await req.text();
  if (!(await isAuthorizedCronCaller(req, rawBody))) {
    return new Response('Unauthorized', { status: 401 });
  }

  await db.scanJob.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MINUTES * 60 * 1000) } },
    data: { status: 'failed', completedAt: new Date(), error: 'Scan timed out (worker was likely killed by the platform function limit)' },
  });

  const job = await db.scanJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    include: { customer: true, website: true },
  });

  if (!job) {
    return NextResponse.json({ processed: false });
  }

  const result = await claimAndRunScanJob(job);
  if (!result.processed) {
    return NextResponse.json({ processed: false });
  }
  return NextResponse.json(
    result.failed ? { processed: true, jobId: job.id, failed: true } : { processed: true, jobId: job.id },
    { status: result.failed ? 500 : 200 }
  );
}
