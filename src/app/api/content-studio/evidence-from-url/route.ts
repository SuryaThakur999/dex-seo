import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { safeFetch } from '@/lib/safe-fetch';
import { AgentReachProvider } from '@/lib/research/providers/agent-reach-provider';
import { detectBlockedSocialHost } from '@/lib/social-host-block';

const EXCERPT_MAX_CHARS = 500;

// Pasted link = arbitrary external article the customer wants to draft from, same
// evidence-pipeline shape as every other v1 source. Reuses the 'own_site' platform tag
// (EvidenceItem.platform is a plain string column, no enum migration) per the plan's
// documented default -- the content is grounding for the company's own draft, not a
// competitor's, matching evidence-normalizer's PRIMARY_PLATFORMS treatment.
export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { websiteId, url } = body;

  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
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

  const blockedHost = detectBlockedSocialHost(url);
  if (blockedHost) {
    return NextResponse.json({ error: `${blockedHost.label} only shows this page to logged-in users, so Dex cannot read it. Paste the post text instead.` }, { status: 400 });
  }

  try {
    await safeFetch(url);
  } catch {
    return NextResponse.json({ error: 'That URL could not be read.' }, { status: 400 });
  }

  const profile = await db.clientProfile.findUnique({ where: { id: website.clientProfileId }, select: { customerId: true } });
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const job = await db.researchJob.create({
    data: { customerId: profile.customerId, clientProfileId: website.clientProfileId, status: 'running', stage: 'evidence_from_url', startedAt: new Date() },
  });

  let document;
  try {
    document = await new AgentReachProvider('web', 'own_site').read({ url });
  } catch {
    return NextResponse.json({ error: 'That page could not be read.' }, { status: 502 });
  }

  const evidence = await db.evidenceItem.create({
    data: {
      researchJobId: job.id,
      entityId: website.clientProfileId,
      platform: 'own_site',
      canonicalUrl: document.canonicalUrl,
      title: null,
      publishedAt: null, // honestly undated -- AgentReachProvider.read() carries no publish date
      excerpt: document.text.slice(0, EXCERPT_MAX_CHARS),
      sourceType: 'other',
      entityMatchConfidence: 1,
      extractionConfidence: 0.3,
      primarySource: true,
      limitations: ['Source gave no publish date; recency cannot be verified.'],
    },
  });

  return NextResponse.json({ evidence });
}
