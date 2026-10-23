import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enqueueScanIfNeeded } from '@/lib/scan-trigger';
import { PENDING_WEBSITE_URL } from '@/lib/customer';

export const maxDuration = 60;

// Verified-on-rescan (docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md, overseer
// gap #1): without this, a finding only ever gets verified if someone presses "Run audit" --
// weekly keeps every website's open findings checked without manual action. This route only
// enqueues; the actual scan (and the resolver it now carries, see run-scan.ts) runs the same
// way any other scan does -- the existing /api/scan/process sweep or QStash picks the job up.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const websites = await db.website.findMany({
    where: { url: { not: PENDING_WEBSITE_URL } },
    select: { id: true, clientProfile: { select: { customerId: true } } },
  });

  let enqueued = 0;
  let alreadyQueued = 0;
  let failed = 0;
  for (const website of websites) {
    try {
      const result = await enqueueScanIfNeeded(website.clientProfile.customerId, website as never);
      if (result.enqueued) enqueued++;
      else alreadyQueued++;
    } catch (err) {
      failed++;
      console.error(`weekly-rescan: website ${website.id} failed to enqueue`, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ processed: websites.length, enqueued, alreadyQueued, failed });
}
