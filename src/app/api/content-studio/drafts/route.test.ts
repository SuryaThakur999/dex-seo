import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST, GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { generateContentVariants } from '@/lib/content-studio/generate-variants';
import { createContentPieceWithVariants } from '@/lib/content-studio/persist-variants';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findFirst: vi.fn() },
    action: { findFirst: vi.fn() },
    finding: { findFirst: vi.fn() },
    contentRecommendation: { findFirst: vi.fn() },
    contentPiece: { findMany: vi.fn(() => []) },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/content-studio/registry', () => ({
  ALL_PLATFORMS: ['linkedin', 'instagram', 'facebook', 'x', 'reddit', 'tiktok', 'youtube', 'ugc_brief'],
}));

vi.mock('@/lib/content-studio/generate-variants', () => ({ generateContentVariants: vi.fn() }));
vi.mock('@/lib/content-studio/persist-variants', () => ({ createContentPieceWithVariants: vi.fn() }));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeGetRequest(clientProfileId: string, websiteId = 'site_1'): NextRequest {
  return new Request(`http://localhost:3000/api/content-studio/drafts?clientProfileId=${clientProfileId}&websiteId=${websiteId}`) as unknown as NextRequest;
}

const profile = {
  id: 'profile_1',
  brandVoice: 'Warm',
  audience: 'SMBs',
  approvedClaims: [],
  restrictedWording: [],
  markets: [],
  languages: [],
};

function variant(index: 0 | 1 | 2, overrides: Record<string, unknown> = {}) {
  return {
    index,
    angle: `angle-${index}`,
    draftContent: { body: `draft-${index}` },
    status: 'draft' as const,
    failureReason: null,
    critique: null,
    tokenCost: 10 + index,
    proofChecks: [],
    ...overrides,
  };
}

describe('POST /api/content-studio/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWebsiteForRequest).mockResolvedValue({ website: { id: 'site_1', url: 'https://example.com' } } as never);
    vi.mocked(generateContentVariants).mockResolvedValue([variant(0), variant(1), variant(2)]);
    vi.mocked(createContentPieceWithVariants).mockResolvedValue({ id: 'piece_1', status: 'draft', variants: [] } as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when topic is missing', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown platform', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'myspace', topic: 'spring sale' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the topic is longer than 500 characters and never calls generation', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'a'.repeat(501) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Topic must be 500 characters or fewer.' });
    expect(generateContentVariants).not.toHaveBeenCalled();
  });

  it('returns 403 when the client profile is not owned by the caller', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(null);
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));
    expect(res.status).toBe(403);
    expect(generateContentVariants).not.toHaveBeenCalled();
  });

  it('rejects a website outside the requested profile before generating or persisting', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    vi.mocked(resolveWebsiteForRequest).mockRejectedValueOnce(new WebsiteNotFoundError('Not found'));
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', websiteId: 'foreign_site', platform: 'linkedin', topic: 'spring sale' }));
    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'foreign_site', 'profile_1');
    expect(res.status).toBe(403);
    expect(generateContentVariants).not.toHaveBeenCalled();
    expect(createContentPieceWithVariants).not.toHaveBeenCalled();
  });

  it('scopes the sourceAction lookup to the requested client profile, not just the workspace', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    // The action belongs to another client profile in the same workspace, so the
    // profile-scoped lookup finds nothing.
    vi.mocked(db.action.findFirst).mockResolvedValue(null);
    const res = await POST(makePostRequest({
      clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale', sourceActionId: 'action_of_other_client',
    }));
    expect(db.action.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'action_of_other_client', websiteId: 'site_1', website: { clientProfileId: 'profile_1' }, customer: { clerkUserId: 'user_1' },
      }),
    }));
    expect(res.status).toBe(403);
    expect(generateContentVariants).not.toHaveBeenCalled();
  });

  it('rejects findings outside the selected website before calling the model', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    vi.mocked(db.finding.findFirst).mockResolvedValue(null);
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', websiteId: 'site_1', platform: 'linkedin', topic: 'Spring', sourceFindingId: 'foreign' }));
    expect(res.status).toBe(403);
    expect(db.finding.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'foreign', websiteId: 'site_1', website: { clientProfileId: 'profile_1' }, customer: { clerkUserId: 'user_1' },
    } }));
    expect(generateContentVariants).not.toHaveBeenCalled();
    expect(createContentPieceWithVariants).not.toHaveBeenCalled();
  });

  it('generates 3 variants and persists them with the first as the representative parent snapshot', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    const variants = [variant(0, { status: 'draft', tokenCost: 50 }), variant(1), variant(2)];
    vi.mocked(generateContentVariants).mockResolvedValue(variants);

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));

    expect(generateContentVariants).toHaveBeenCalledWith(expect.objectContaining({ websiteId: 'site_1', platform: 'linkedin', topic: 'spring sale' }));
    expect(createContentPieceWithVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        clientProfileId: 'profile_1', websiteId: 'site_1',
        draftContent: variants[0].draftContent, status: 'draft', failureReason: null,
      }),
      variants,
    );
    expect(res.status).toBe(200);
  });

  it("uses variant 0's failed status as the representative parent status when generation fails", async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    const variants = [
      variant(0, { status: 'failed', draftContent: {}, failureReason: 'We could not generate this draft. Please try again.', tokenCost: 0 }),
      variant(1, { status: 'failed', draftContent: {}, failureReason: 'We could not generate this draft. Please try again.', tokenCost: 0 }),
      variant(2, { status: 'failed', draftContent: {}, failureReason: 'We could not generate this draft. Please try again.', tokenCost: 0 }),
    ];
    vi.mocked(generateContentVariants).mockResolvedValue(variants);

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));

    expect(createContentPieceWithVariants).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failureReason: 'We could not generate this draft. Please try again.' }),
      variants,
    );
    expect(res.status).toBe(200);
  });

  it('lets a persistence failure on the success path propagate as a 500 instead of being silently swallowed', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    vi.mocked(createContentPieceWithVariants).mockRejectedValue(new Error('connection reset'));

    await expect(
      POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }))
    ).rejects.toThrow('connection reset');
  });

  it('saves server-loaded Finding evidence, not a client-forged payload', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    vi.mocked(db.finding.findFirst).mockResolvedValue({
      id: 'finding_1', ruleId: 'missing_title', pageUrl: 'https://example.com/page',
      retrievedAt: new Date('2026-10-13T12:00:00Z'), evidence: { title: null }, limitations: 'One page only',
    } as never);

    await POST(makePostRequest({
      clientProfileId: 'profile_1', platform: 'linkedin', topic: 'Spring', sourceFindingId: 'finding_1', evidenceJson: { forged: true },
    }));

    const evidence = {
      kind: 'finding', findingId: 'finding_1', ruleId: 'missing_title', pageUrl: 'https://example.com/page',
      retrievedAt: '2026-10-13T12:00:00.000Z', evidence: { title: null }, limitations: 'One page only',
    };
    expect(generateContentVariants).toHaveBeenCalledWith(expect.objectContaining({ sourceFinding: evidence }));
    expect(createContentPieceWithVariants).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFindingId: 'finding_1', evidence }),
      expect.anything(),
    );
  });

  it('rejects recommendations outside the selected website before calling the model', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    vi.mocked(db.contentRecommendation.findFirst).mockResolvedValue(null);
    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', websiteId: 'site_1', platform: 'linkedin', topic: 'Spring', sourceRecommendationId: 'foreign' }));
    expect(res.status).toBe(403);
    expect(db.contentRecommendation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'foreign', websiteId: 'site_1', clientProfileId: 'profile_1',
    } }));
    expect(generateContentVariants).not.toHaveBeenCalled();
    expect(createContentPieceWithVariants).not.toHaveBeenCalled();
  });

  it('persists sourceRecommendationId when the recommendation is owned by the requested profile/website', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    vi.mocked(db.contentRecommendation.findFirst).mockResolvedValue({ id: 'rec_1' } as never);

    await POST(makePostRequest({
      clientProfileId: 'profile_1', platform: 'linkedin', topic: 'Pricing moves', sourceRecommendationId: 'rec_1',
    }));

    expect(createContentPieceWithVariants).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRecommendationId: 'rec_1' }),
      expect.anything(),
    );
  });
});

describe('GET /api/content-studio/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWebsiteForRequest).mockResolvedValue({ website: { id: 'site_1' } } as never);
  });

  it('rejects an inaccessible website without querying drafts', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(profile as never);
    vi.mocked(resolveWebsiteForRequest).mockRejectedValueOnce(new WebsiteNotFoundError('Not found'));
    const res = await GET(makeGetRequest('profile_1', 'foreign_site'));
    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'foreign_site', 'profile_1');
    expect(res.status).toBe(403);
    expect(db.contentPiece.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const res = await GET(makeGetRequest('profile_1'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when the client profile is not owned by the caller', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(null);
    const res = await GET(makeGetRequest('profile_1'));
    expect(res.status).toBe(403);
  });

  it('lists content pieces with their ordered variants, newest first', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue({ id: 'profile_1' } as never);
    vi.mocked(db.contentPiece.findMany).mockResolvedValue([{ id: 'piece_1', variants: [{ index: 0 }, { index: 1 }] }] as never);

    const res = await GET(makeGetRequest('profile_1'));
    const body = await res.json();

    expect(db.contentPiece.findMany).toHaveBeenCalledWith({
      where: { clientProfileId: 'profile_1', websiteId: 'site_1' },
      orderBy: { createdAt: 'desc' },
      include: { variants: { orderBy: { index: 'asc' } } },
    });
    expect(body).toEqual([{ id: 'piece_1', variants: [{ index: 0 }, { index: 1 }] }]);
  });
});
