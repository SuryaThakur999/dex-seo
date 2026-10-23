import { NextRequest, NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';
import { db } from '@/lib/db';
import { claimAndRunGenerationJob, reapStaleGenerationJobs } from '@/lib/generation-worker';

// Every real generator call here completes in low single-digit seconds -- this is a much
// smaller runtime budget than /api/scan/process's 300s (a whole crawl+draft loop), but kept
// generous relative to real generation latency rather than tight against it.
export const maxDuration = 60;

// Same dual-auth pattern /api/scan/process already uses (Vercel cron bearer secret OR QStash
// signed request) -- kept as a direct copy rather than a shared helper: this project already
// has two independent instances of this exact check, and a shared abstraction over
// authentication is a higher-risk refactor than the duplication it would remove.
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
    return false;
  }
}

export async function GET(req: NextRequest) {
  const rawBody = await req.text();
  if (!(await isAuthorizedCronCaller(req, rawBody))) {
    return new Response('Unauthorized', { status: 401 });
  }

  await reapStaleGenerationJobs();

  const job = await db.generationJob.findFirst({
    where: {
      status: { in: ['queued', 'waiting_retry', 'rate_limited', 'blocked'] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!job) {
    return NextResponse.json({ processed: false });
  }

  const result = await claimAndRunGenerationJob(job.id);
  if (!result.processed) {
    return NextResponse.json({ processed: false });
  }
  return NextResponse.json(
    { processed: true, jobId: job.id, outcome: result.outcome },
    { status: result.outcome === 'failed' ? 500 : 200 }
  );
}
