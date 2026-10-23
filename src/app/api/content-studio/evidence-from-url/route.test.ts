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
  return new Request('http://localhost:3000/api/content-studio/evidence-from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const website = { id: 'site_1', clientProfileId: 'profile_1' };

describe('POST /api/content-studio/evidence-from-url', () => {
  let readMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    readMock = vi.fn();
    (AgentReachProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ read: readMock }));
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website, websites: [website] });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ customerId: 'customer_1' });
    (db.researchJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'https://trade-press.test/article' }));
    expect(res.status).toBe(401);
  });

  it('rejects a websiteId not owned by this customer before any fetch', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));
    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'https://trade-press.test/article' }));
    expect(res.status).toBe(403);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('rejects a URL that fails the safeFetch allowlist/SSRF check before any Agent Reach call', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('blocked by allowlist'));
    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'http://169.254.169.254/latest' }));
    expect(res.status).toBe(400);
    expect(readMock).not.toHaveBeenCalled();
  });

  it('stores an EvidenceItem for a valid URL with an honestly-undated excerpt', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    readMock.mockResolvedValue({ canonicalUrl: 'https://trade-press.test/article', text: 'A'.repeat(600), retrievedAt: new Date('2026-10-14T00:00:00Z') });
    (db.evidenceItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ev_1', canonicalUrl: 'https://trade-press.test/article', excerpt: 'A'.repeat(500), publishedAt: null,
    });

    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'https://trade-press.test/article' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.id).toBe('ev_1');

    expect(db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        researchJobId: 'job_1',
        entityId: 'profile_1',
        platform: 'own_site',
        canonicalUrl: 'https://trade-press.test/article',
        publishedAt: null,
        excerpt: expect.stringMatching(/^A{500}$/),
      }),
    }));
  });

  it('rejects a missing or non-string url', async () => {
    const res = await POST(makeRequest({ websiteId: 'site_1' }));
    expect(res.status).toBe(400);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('gives a platform-specific blocked-host message for LinkedIn before any fetch attempt (social-profile-discovery plan, 2026-10-17)', async () => {
    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'https://www.linkedin.com/posts/acme_123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('LinkedIn only shows this page to logged-in users, so Dex cannot read it. Paste the post text instead.');
    expect(safeFetch).not.toHaveBeenCalled();
    expect(readMock).not.toHaveBeenCalled();
  });
});
