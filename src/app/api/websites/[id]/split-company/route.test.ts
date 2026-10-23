import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { POST } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));
vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

function makeRequest(): NextRequest {
  return {} as unknown as NextRequest;
}

describe('POST /api/websites/:id/split-company', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    expect(res.status).toBe(401);
  });

  it('returns 404 when the website is not owned by this customer', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(resolveWebsiteForRequest).mockRejectedValue(new WebsiteNotFoundError('not found'));
    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    expect(res.status).toBe(404);
  });

  it('creates the new profile named from the real host, copying brand fields as a starting point, and moves Website/ProfileSuggestion/ResearchJob/ContentRecommendation -- never CompetitorEntity or ContentPiece', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(resolveWebsiteForRequest).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'cp_old', normalizedHost: 'b.test' },
      websites: [],
    } as never);
    vi.mocked(db.clientProfile.findUniqueOrThrow).mockResolvedValue({
      businessDescription: 'desc', audience: 'aud', brandVoice: 'voice',
      approvedClaims: ['x'], restrictedWording: ['y'], markets: ['DE'], languages: ['de'],
    } as never);
    const tx = {
      clientProfile: { create: vi.fn().mockResolvedValue({ id: 'cp_new' }) },
      website: { update: vi.fn() },
      profileSuggestion: { updateMany: vi.fn() },
      researchJob: { updateMany: vi.fn() },
      contentRecommendation: { updateMany: vi.fn() },
    };
    type Tx = typeof tx;
    (db.$transaction as unknown as { mockImplementation: (fn: (cb: (t: Tx) => unknown) => unknown) => void })
      .mockImplementation((cb) => cb(tx));

    const res = await POST(makeRequest(), { params: { id: 'w1' } });

    expect(tx.clientProfile.create).toHaveBeenCalledWith({
      data: {
        customerId: 'cust_1', name: 'b.test', isDefault: false,
        businessDescription: 'desc', audience: 'aud', brandVoice: 'voice',
        approvedClaims: ['x'], restrictedWording: ['y'], markets: ['DE'], languages: ['de'],
      },
    });
    // Composite-FK order: Website's clientProfileId must move before any row
    // referencing (websiteId, clientProfileId) is updated to match it.
    expect(tx.website.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect(tx.profileSuggestion.updateMany).toHaveBeenCalledWith({ where: { websiteId: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect(tx.researchJob.updateMany).toHaveBeenCalledWith({ where: { websiteId: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect(tx.contentRecommendation.updateMany).toHaveBeenCalledWith({ where: { websiteId: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect((tx as Record<string, unknown>).competitorEntity).toBeUndefined();
    expect((tx as Record<string, unknown>).contentPiece).toBeUndefined();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clientProfileId: 'cp_new' });
  });
});
