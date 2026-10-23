import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Flags a queued/running ScanJob for cancellation. /api/scan runs the scan inline in its own
// serverless invocation with no worker to signal directly, so this route can only set a flag
// the scan loop itself polls (see isCancelled in run-scan.ts) -- it does not stop anything
// synchronously, and the job may take up to one page/draft's worth of latency to actually stop.
export async function POST(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const job = await db.scanJob.findUnique({ where: { id: params.jobId } });
  if (!job || job.customerId !== customer.id) {
    return NextResponse.json({ error: 'Scan job not found' }, { status: 404 });
  }

  // Conditional on the job still being in a cancellable state -- a job that finished (or was
  // already cancelled) between this check and the write must not be silently reopened.
  const updated = await db.scanJob.updateMany({
    where: { id: job.id, status: { in: ['queued', 'running'] } },
    data: { cancelRequested: true },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: 'This scan already finished and cannot be cancelled.' }, { status: 400 });
  }

  return NextResponse.json({ cancelRequested: true });
}
