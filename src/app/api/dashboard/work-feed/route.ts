import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export const dynamic = 'force-dynamic';

const SCAN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
type ScanStatus = (typeof SCAN_STATUSES)[number] | 'unknown';

function scanStatus(value: string): ScanStatus {
  return (SCAN_STATUSES as readonly string[]).includes(value)
    ? value as (typeof SCAN_STATUSES)[number]
    : 'unknown';
}

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

  const scans = await db.scanJob.findMany({
    where: { websiteId: website.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { findings: { select: { id: true, ruleId: true, severity: true } } },
  });

  return NextResponse.json(scans.map(scan => ({
    scanId: scan.id,
    timestamp: (scan.startedAt ?? scan.createdAt).toISOString(),
    status: scanStatus(scan.status),
    findingCount: scan.findings.length,
    findings: scan.findings,
  })));
}
