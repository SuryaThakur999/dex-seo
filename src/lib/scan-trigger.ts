import { db } from './db';
import type { Website } from '@prisma/client';

/**
 * Enqueues a scan job for a website unless one is already queued/running.
 * Shared by the "Run audit" button (/api/scan) and the command bar's
 * run_audit intent so both go through the exact same dedup + creation path.
 * Returns the relevant job's id either way, so a caller can run a freshly
 * created job immediately rather than waiting for the next cron sweep.
 */
export async function enqueueScanIfNeeded(customerId: string, website: Website): Promise<{ enqueued: boolean; jobId: string }> {
  const existingJob = await db.scanJob.findFirst({
    where: { websiteId: website.id, status: { in: ['queued', 'running'] } },
  });
  if (existingJob) return { enqueued: false, jobId: existingJob.id };

  const job = await db.scanJob.create({ data: { customerId, websiteId: website.id, status: 'queued' } });
  return { enqueued: true, jobId: job.id };
}
