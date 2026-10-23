import type { Customer, Prisma, Website } from '@prisma/client';
import { db } from '@/lib/db';
import { runScanForCustomer } from '@/lib/run-scan';

/**
 * Claims one already-created ScanJob (no-ops if a concurrent invocation
 * already claimed it) and runs it to completion, recording the result and
 * log lines. Shared by the cron-driven sweep in /api/scan/process (which
 * discovers the job) and the inline trigger fired right after a customer's
 * own request enqueues a job — a scan needs to actually run promptly, not
 * only ever get picked up on the next cron tick.
 */
export async function claimAndRunScanJob(job: {
  id: string;
  customer: Customer;
  website: Website;
}): Promise<{ processed: boolean; failed?: boolean }> {
  const claimed = await db.scanJob.updateMany({
    where: { id: job.id, status: 'queued' },
    data: { status: 'running', startedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { processed: false };
  }

  await db.scanLogLine.create({
    data: { scanJobId: job.id, message: `Starting scan for ${job.website.url}...` },
  });

  try {
    const result = await runScanForCustomer(job.customer, job.website, job.id);
    await db.scanJob.update({
      where: { id: job.id },
      data: {
        status: result.cancelled ? 'cancelled' : 'completed',
        completedAt: new Date(),
        resultSummary: result as unknown as Prisma.InputJsonValue,
      },
    });
    await db.scanLogLine.create({
      data: {
        scanJobId: job.id,
        message: result.cancelled
          ? `Scan cancelled — ${result.pagesScanned} pages checked, ${result.draftsCreated} draft${result.draftsCreated === 1 ? '' : 's'} created before stopping.`
          : `Scan complete — ${result.pagesScanned} pages checked, ${result.draftsCreated} draft${result.draftsCreated === 1 ? '' : 's'} created.`,
      },
    });
    return { processed: true };
  } catch (err) {
    await db.scanJob.update({
      where: { id: job.id },
      data: { status: 'failed', completedAt: new Date(), error: err instanceof Error ? err.message : 'Unknown error' },
    });
    await db.scanLogLine.create({
      data: { scanJobId: job.id, message: `Scan failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
    });
    return { processed: true, failed: true };
  }
}
