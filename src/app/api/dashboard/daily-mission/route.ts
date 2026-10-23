import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { computeNextMission } from '@/lib/daily-mission-logic';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const websiteId = request.nextUrl.searchParams.get('websiteId');
  if (!websiteId) return new Response('websiteId is required', { status: 400 });

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, websiteId));
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) return new Response('Not found', { status: 404 });
    throw error;
  }

  const [activeScans, pendingActions] = await Promise.all([
    db.scanJob.count({
      where: { websiteId: website.id, status: { in: ['queued', 'running'] } },
    }),
    db.action.count({ where: { websiteId: website.id, status: 'pending' } }),
  ]);

  return NextResponse.json(computeNextMission({ activeScans, pendingActions }));
}
