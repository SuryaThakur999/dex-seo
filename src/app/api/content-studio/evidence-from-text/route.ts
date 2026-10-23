import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

const EXCERPT_MAX_CHARS = 500;

// Owner-provided fallback for a host Studio can't fetch (LinkedIn/Instagram/Facebook/X/TikTok,
// see social-host-block.ts) -- never calls safeFetch or AgentReachProvider, since the whole
// point is this evidence never gets fetched. `url` is kept only as a reference the owner
// recognizes later, not a source Dex has verified by reading it itself.
export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { websiteId, url, text } = body;

  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, websiteId));
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 403 });
    }
    throw error;
  }

  const profile = await db.clientProfile.findUnique({ where: { id: website.clientProfileId }, select: { customerId: true } });
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const job = await db.researchJob.create({
    data: { customerId: profile.customerId, clientProfileId: website.clientProfileId, status: 'running', stage: 'evidence_from_text', startedAt: new Date() },
  });

  const evidence = await db.evidenceItem.create({
    data: {
      researchJobId: job.id,
      entityId: website.clientProfileId,
      platform: 'owner_provided',
      canonicalUrl: url,
      title: null,
      publishedAt: null,
      excerpt: text.trim().slice(0, EXCERPT_MAX_CHARS),
      sourceType: 'other',
      entityMatchConfidence: 1,
      extractionConfidence: 1, // the owner typed it themselves -- no extraction uncertainty
      primarySource: true,
      limitations: ['Owner-provided text, not independently verified by Dex.'],
    },
  });

  return NextResponse.json({ evidence });
}
