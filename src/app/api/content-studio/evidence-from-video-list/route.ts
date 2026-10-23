import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { listRecentVideos } from '@/lib/research/youtube-channel-videos';

// Backs the Studio evidence-source picker's "pick a video" step (Task 24): lists a channel's
// recent uploads so the owner can choose one before Task 23's evidence-from-video route reads
// its captions. Read-only -- no EvidenceItem/ResearchJob created here, those are Task 23's job.
export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { websiteId, channelUrl } = body;

  if (typeof channelUrl !== 'string' || !channelUrl.trim()) {
    return NextResponse.json({ error: 'channelUrl is required' }, { status: 400 });
  }

  try {
    await resolveWebsiteForRequest(userId, websiteId);
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 403 });
    }
    throw error;
  }

  try {
    const videos = await listRecentVideos(channelUrl);
    return NextResponse.json({
      videos: videos.map((v) => ({ id: v.id, title: v.title, publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null })),
    });
  } catch {
    return NextResponse.json({ error: 'That channel could not be read.' }, { status: 400 });
  }
}
