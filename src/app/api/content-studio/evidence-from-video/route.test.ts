import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { safeFetch } from '@/lib/safe-fetch';
import { AgentReachProvider } from '@/lib/research/providers/agent-reach-provider';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/safe-fetch', () => ({
  safeFetch: vi.fn(),
  UnsafeUrlError: class UnsafeUrlError extends Error {},
}));

vi.mock('@/lib/research/providers/agent-reach-provider', () => ({
  AgentReachProvider: vi.fn().mockImplementation(() => ({ read: vi.fn() })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findUnique: vi.fn() },
    researchJob: { create: vi.fn() },
    evidenceItem: { create: vi.fn() },
  },
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/evidence-from-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const website = { id: 'site_1', clientProfileId: 'profile_1' };

describe('POST /api/content-studio/evidence-from-video', () => {
  let readMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    readMock = vi.fn();
    (AgentReachProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ read: readMock }));
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website, websites: [website] });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ customerId: 'customer_1' });
    (db.researchJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_1' });
    (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await POST(makeRequest({ websiteId: 'site_1', videoId: 'vid1' }));
    expect(res.status).toBe(401);
  });

  it('rejects a websiteId not owned by this customer', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));
    const res = await POST(makeRequest({ websiteId: 'site_1', videoId: 'vid1' }));
    expect(res.status).toBe(403);
  });

  it('rejects a missing or non-string videoId', async () => {
    const res = await POST(makeRequest({ websiteId: 'site_1' }));
    expect(res.status).toBe(400);
    expect(readMock).not.toHaveBeenCalled();
  });

  it('stores an EvidenceItem with the caption excerpt when captions are available', async () => {
    readMock.mockResolvedValue({
      canonicalUrl: 'https://www.youtube.com/watch?v=vid1', text: 'Caption transcript text.',
      retrievedAt: new Date('2026-10-14T00:00:00Z'), publishedAt: new Date('2026-10-01T00:00:00Z'), hasCaptions: true,
    });
    (db.evidenceItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ev_1' });

    const res = await POST(makeRequest({ websiteId: 'site_1', videoId: 'vid1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.id).toBe('ev_1');

    expect(readMock).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=vid1' });
    expect(db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        researchJobId: 'job_1',
        entityId: 'profile_1',
        platform: 'youtube',
        canonicalUrl: 'https://www.youtube.com/watch?v=vid1',
        publishedAt: new Date('2026-10-01T00:00:00Z'),
        excerpt: 'Caption transcript text.',
        limitations: [],
      }),
    }));
  });

  it('handles a video with no captions as a typed "no captions" result, never a thrown error', async () => {
    readMock.mockResolvedValue({
      canonicalUrl: 'https://www.youtube.com/watch?v=vid2', text: 'Just the description.',
      retrievedAt: new Date('2026-10-14T00:00:00Z'), publishedAt: null, hasCaptions: false,
    });
    (db.evidenceItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ev_2' });

    const res = await POST(makeRequest({ websiteId: 'site_1', videoId: 'vid2' }));
    expect(res.status).toBe(200);

    expect(db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        limitations: ['No captions available for this video; excerpt is the video description only.'],
        extractionConfidence: 0.5,
      }),
    }));
  });
});
