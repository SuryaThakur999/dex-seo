import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const websiteId = req.nextUrl.searchParams.get('websiteId') ?? undefined;
  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, websiteId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) return new Response('Not found', { status: 404 });
    throw err;
  }

  // Scoped to this website, not the whole customer — a customer with several sites must
  // never see one site's scan terminal while looking at another's dashboard.
  const jobs = await db.scanJob.findMany({
    where: { websiteId: website.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, status: true, createdAt: true, completedAt: true, error: true, resultSummary: true },
  });

  const logLines = jobs[0]
    ? await db.scanLogLine.findMany({
        where: { scanJobId: jobs[0].id },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { id: true, message: true, createdAt: true },
      })
    : [];

  return NextResponse.json({ jobs, logLines });
}
