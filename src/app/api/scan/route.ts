import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { enqueueScanIfNeeded } from '@/lib/scan-trigger';
import { claimAndRunScanJob } from '@/lib/scan-worker';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';

// Raised alongside MAX_PAGES_PER_SCAN (run-scan.ts) so a larger crawl has room to actually
// finish instead of being truncated by the function timeout mid-scan. 300s is the real ceiling
// for a standard Vercel serverless function — if the account's plan is below that tier, Vercel
// silently caps it back down; this value is a request for the max available, not a guarantee.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData().catch(() => null);
  const websiteId = form?.get('websiteId');

  let customer, website;
  try {
    ({ customer, website } = await resolveWebsiteForRequest(
      userId,
      typeof websiteId === 'string' ? websiteId : undefined
    ));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }
  if (website.url === PENDING_WEBSITE_URL) {
    return NextResponse.json(
      { error: "Confirm this website's URL before running an audit." },
      { status: 400 }
    );
  }

  const { enqueued, jobId } = await enqueueScanIfNeeded(customer.id, website);
  if (enqueued) {
    // No cron currently sweeps queued jobs frequently enough for a responsive
    // "Run audit" click, so run it inline rather than leaving it queued —
    // the cron sweep in /api/scan/process stays as a safety net for a job
    // that fails to run here (e.g. a crash mid-request).
    await claimAndRunScanJob({ id: jobId, customer, website });
  }

  return NextResponse.redirect(new URL(`/dashboard/${website.id}`, req.url), 303);
}
