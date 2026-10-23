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

vi.mock('@/lib/safe-fetch', () => ({ safeFetch: vi.fn() }));

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
  return new Request('http://localhost:3000/api/content-studio/evidence-from-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const website = { id: 'site_1', clientProfileId: 'profile_1' };

describe('POST /api/content-studio/evidence-from-text (social-profile-discovery plan, 2026-10-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website, websites: [website] });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ customerId: 'customer_1' });
    (db.researchJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'https://linkedin.com/posts/acme', text: 'Our new product launch...' }));
    expect(res.status).toBe(401);
  });

  it('rejects a missing or empty text', async () => {
    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'https://linkedin.com/posts/acme', text: '' }));
    expect(res.status).toBe(400);
  });

  it('creates an EvidenceItem with platform owner_provided, never calling safeFetch or AgentReachProvider', async () => {
    (db.evidenceItem.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'ev_1', canonicalUrl: 'https://linkedin.com/posts/acme', excerpt: 'Our new product launch...',
    });

    const res = await POST(makeRequest({ websiteId: 'site_1', url: 'https://linkedin.com/posts/acme', text: 'Our new product launch...' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence.id).toBe('ev_1');
    expect(safeFetch).not.toHaveBeenCalled();
    expect(AgentReachProvider).not.toHaveBeenCalled();
    expect(db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        researchJobId: 'job_1',
        entityId: 'profile_1',
        platform: 'owner_provided',
        canonicalUrl: 'https://linkedin.com/posts/acme',
        excerpt: 'Our new product launch...',
      }),
    }));
  });
});
