import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { listRecentVideos } from '@/lib/research/youtube-channel-videos';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/research/youtube-channel-videos', () => ({ listRecentVideos: vi.fn() }));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/evidence-from-video-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const website = { id: 'site_1', clientProfileId: 'profile_1' };

describe('POST /api/content-studio/evidence-from-video-list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website, websites: [website] });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await POST(makeRequest({ websiteId: 'site_1', channelUrl: 'https://youtube.test/@channel/videos' }));
    expect(res.status).toBe(401);
  });

  it('rejects a websiteId not owned by this customer', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));
    const res = await POST(makeRequest({ websiteId: 'site_1', channelUrl: 'https://youtube.test/@channel/videos' }));
    expect(res.status).toBe(403);
  });

  it('rejects a missing or non-string channelUrl before calling the lister', async () => {
    const res = await POST(makeRequest({ websiteId: 'site_1' }));
    expect(res.status).toBe(400);
    expect(listRecentVideos).not.toHaveBeenCalled();
  });

  it('returns the listed videos for a valid channel URL', async () => {
    (listRecentVideos as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'vid1', title: 'Video one', publishedAt: new Date('2026-10-01T00:00:00.000Z') },
    ]);
    const res = await POST(makeRequest({ websiteId: 'site_1', channelUrl: 'https://youtube.test/@channel/videos' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videos).toEqual([{ id: 'vid1', title: 'Video one', publishedAt: '2026-10-01T00:00:00.000Z' }]);
    expect(listRecentVideos).toHaveBeenCalledWith('https://youtube.test/@channel/videos');
  });

  it('reports an honest failure rather than throwing when the channel URL is rejected or unreachable', async () => {
    (listRecentVideos as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('blocked'));
    const res = await POST(makeRequest({ websiteId: 'site_1', channelUrl: 'http://169.254.169.254/videos' }));
    expect(res.status).toBe(400);
  });
});
