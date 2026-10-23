import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { safeFetch } from '@/lib/safe-fetch';
import { AgentReachProvider } from '@/lib/research/providers/agent-reach-provider';

const EXCERPT_MAX_CHARS = 500;
const NO_CAPTIONS_LIMITATION = 'No captions available for this video; excerpt is the video description only.';

// Companion to Task 22's paste-a-link route: a chosen video id becomes an EvidenceItem built
// from Agent Reach's youtube channel. Unlike the web channel, youtube genuinely reports a
// publish date and whether captions (vs. description-only) backed the excerpt -- both are
// passed through rather than discarded, per this phase's "never fabricate, never flatten an
// honest distinction" convention.
export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { websiteId, videoId } = body;

  if (typeof videoId !== 'string' || !videoId.trim()) {
    return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
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

  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  try {
    await safeFetch(videoUrl);
  } catch {
    return NextResponse.json({ error: 'That video could not be read.' }, { status: 400 });
  }

  const profile = await db.clientProfile.findUnique({ where: { id: website.clientProfileId }, select: { customerId: true } });
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const job = await db.researchJob.create({
    data: { customerId: profile.customerId, clientProfileId: website.clientProfileId, status: 'running', stage: 'evidence_from_video', startedAt: new Date() },
  });

  let document;
  try {
    document = await new AgentReachProvider('youtube', 'youtube').read({ url: videoUrl });
  } catch {
    return NextResponse.json({ error: 'That video could not be read.' }, { status: 502 });
  }

  const hasCaptions = document.hasCaptions === true;

  const evidence = await db.evidenceItem.create({
    data: {
      researchJobId: job.id,
      entityId: website.clientProfileId,
      platform: 'youtube',
      canonicalUrl: document.canonicalUrl,
      title: null,
      publishedAt: document.publishedAt ?? null,
      excerpt: document.text.slice(0, EXCERPT_MAX_CHARS),
      sourceType: 'other',
      entityMatchConfidence: 1,
      extractionConfidence: hasCaptions ? 0.9 : 0.5,
      primarySource: true,
      limitations: hasCaptions ? [] : [NO_CAPTIONS_LIMITATION],
    },
  });

  return NextResponse.json({ evidence });
}
