import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { generateContentVariant } from '@/lib/content-studio/generate-variants';
import { ContentVariantRetryConflictError, retryContentVariant, retryLegacyContentPiece } from '@/lib/content-studio/persist-variants';
import { CUSTOMER_SAFE_GENERATION_ERROR } from '@/lib/customer-safe-error';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/db', () => ({
  db: {
    contentPiece: { findFirst: vi.fn(), findUnique: vi.fn() },
    action: { findFirst: vi.fn() },
    finding: { findFirst: vi.fn() },
  },
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/content-studio/generate-variants', () => ({ generateContentVariant: vi.fn() }));
vi.mock('@/lib/content-studio/persist-variants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/content-studio/persist-variants')>(
    '@/lib/content-studio/persist-variants'
  );
  return { ...actual, retryContentVariant: vi.fn(), retryLegacyContentPiece: vi.fn() };
});

function makeRequest(body: unknown = { index: 1 }): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/drafts/piece_1/retry', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const pieceWithVariants = {
  id: 'piece_1',
  platform: 'linkedin',
  topic: 'spring sale',
  sourceActionId: null,
  sourceFindingId: null,
  evidence: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
  clientProfileId: 'profile_1',
  websiteId: 'site_1',
  clientProfile: { id: 'profile_1', brandVoice: null, audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  variants: [
    { id: 'variant_0', index: 0, status: 'draft', tokenCost: 50 },
    { id: 'variant_1', index: 1, status: 'failed', tokenCost: 20 },
    { id: 'variant_2', index: 2, status: 'draft', tokenCost: 45 },
  ],
};

const generatedVariant = {
  index: 1,
  angle: 'Decision guide',
  draftContent: { body: 'New copy.', hashtags: [] },
  status: 'draft' as const,
  failureReason: null,
  critique: null,
  tokenCost: 40,
  proofChecks: [{ check: 'ai-content-disclosure', result: 'pass', detail: 'ok' }],
};

describe('POST /api/content-studio/drafts/[id]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWebsiteForRequest).mockResolvedValue({ website: { id: 'site_1', url: 'https://example.com' } } as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const res = await POST(makeRequest(), { params: { id: 'piece_1' } });
    expect(res.status).toBe(401);
  });

  it.each([
    ['missing', {}],
    ['non-integer', { index: 1.5 }],
    ['negative', { index: -1 }],
    ['out of range', { index: 3 }],
  ])('returns 400 for a %s index before touching the DB', async (_label, body) => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    const res = await POST(makeRequest(body), { params: { id: 'piece_1' } });
    expect(res.status).toBe(400);
    expect(db.contentPiece.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when the request body is not valid JSON', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    const req = new Request('http://localhost:3000/api/content-studio/drafts/piece_1/retry', {
      method: 'POST',
      body: 'not json',
    }) as unknown as NextRequest;
    const res = await POST(req, { params: { id: 'piece_1' } });
    expect(res.status).toBe(400);
  });

  it('returns 403 when the piece is not owned by the caller', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: { id: 'piece_1' } });
    expect(res.status).toBe(403);
  });

  it('returns 404 when no variant exists at the requested index', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({
      ...pieceWithVariants,
      variants: pieceWithVariants.variants.slice(0, 1),
    } as never);
    const res = await POST(makeRequest({ index: 2 }), { params: { id: 'piece_1' } });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a legacy piece (no stored variants) when a non-zero index is requested', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({ ...pieceWithVariants, variants: [], status: 'failed' } as never);
    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });
    expect(res.status).toBe(404);
    expect(generateContentVariant).not.toHaveBeenCalled();
  });

  it('returns 409 for a legacy piece that is not in a failed state', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({ ...pieceWithVariants, variants: [], status: 'draft' } as never);
    const res = await POST(makeRequest({ index: 0 }), { params: { id: 'piece_1' } });
    expect(res.status).toBe(409);
    expect(generateContentVariant).not.toHaveBeenCalled();
  });

  it('retries a legacy piece (no stored variants) directly on ContentPiece, not via retryContentVariant', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({ ...pieceWithVariants, variants: [], status: 'failed' } as never);
    vi.mocked(generateContentVariant).mockResolvedValue(generatedVariant);
    vi.mocked(retryLegacyContentPiece).mockResolvedValue({ id: 'piece_1', status: 'draft', tokenCost: 40 } as never);
    vi.mocked(db.contentPiece.findUnique).mockResolvedValue({ id: 'piece_1', variants: [] } as never);

    const res = await POST(makeRequest({ index: 0 }), { params: { id: 'piece_1' } });

    expect(generateContentVariant).toHaveBeenCalledWith(expect.objectContaining({ websiteId: 'site_1' }), 0);
    expect(retryLegacyContentPiece).toHaveBeenCalledWith('piece_1', expect.objectContaining({
      draftContent: generatedVariant.draftContent,
      status: generatedVariant.status,
      tokenCost: generatedVariant.tokenCost,
    }));
    expect(retryContentVariant).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('returns 409 when the selected variant is not in a failed state', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue(pieceWithVariants as never);
    const res = await POST(makeRequest({ index: 0 }), { params: { id: 'piece_1' } });
    expect(res.status).toBe(409);
    expect(generateContentVariant).not.toHaveBeenCalled();
  });

  it('regenerates the selected variant and persists it on success', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue(pieceWithVariants as never);
    vi.mocked(generateContentVariant).mockResolvedValue(generatedVariant);
    vi.mocked(retryContentVariant).mockResolvedValue({ id: 'variant_1', index: 1, tokenCost: 60 } as never);
    vi.mocked(db.contentPiece.findUnique).mockResolvedValue({ id: 'piece_1', variants: pieceWithVariants.variants } as never);

    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'site_1', 'profile_1');
    expect(generateContentVariant).toHaveBeenCalledWith(expect.objectContaining({ websiteId: 'site_1' }), 1);
    expect(retryContentVariant).toHaveBeenCalledWith('piece_1', 1, expect.objectContaining({
      angle: generatedVariant.angle,
      draftContent: generatedVariant.draftContent,
      status: 'draft',
      tokenCost: 40,
    }));
    expect(res.status).toBe(200);
  });

  it('does not assign a default website to a legacy draft', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({ ...pieceWithVariants, websiteId: null } as never);
    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });
    expect(res.status).toBe(400);
    expect(resolveWebsiteForRequest).not.toHaveBeenCalled();
    expect(generateContentVariant).not.toHaveBeenCalled();
  });

  it('rejects a stored website outside the owned profile before generation', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue(pieceWithVariants as never);
    vi.mocked(resolveWebsiteForRequest).mockRejectedValue(new WebsiteNotFoundError('site_1'));
    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });
    expect(res.status).toBe(403);
    expect(generateContentVariant).not.toHaveBeenCalled();
    expect(retryContentVariant).not.toHaveBeenCalled();
  });

  it('rejects a stored source action outside the draft website', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({ ...pieceWithVariants, sourceActionId: 'action_1' } as never);
    vi.mocked(db.action.findFirst).mockResolvedValue(null);
    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });
    expect(db.action.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: 'action_1', websiteId: 'site_1', website: { clientProfileId: 'profile_1' }, customer: { clerkUserId: 'user_1' },
    } }));
    expect(res.status).toBe(403);
    expect(generateContentVariant).not.toHaveBeenCalled();
  });

  it('rejects a stored finding outside the draft website before generation', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({ ...pieceWithVariants, sourceFindingId: 'finding_1' } as never);
    vi.mocked(db.finding.findFirst).mockResolvedValue(null);
    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });
    expect(db.finding.findFirst).toHaveBeenCalledWith({ where: {
      id: 'finding_1', websiteId: 'site_1', website: { clientProfileId: 'profile_1' }, customer: { clerkUserId: 'user_1' },
    }, select: { id: true } });
    expect(res.status).toBe(403);
    expect(generateContentVariant).not.toHaveBeenCalled();
    expect(retryContentVariant).not.toHaveBeenCalled();
  });

  it('uses the saved snapshot after the original finding is deleted', async () => {
    const evidenceJson = { kind: 'finding', findingId: 'deleted_finding', ruleId: 'meta-description', pageUrl: 'https://example.com', retrievedAt: '2026-10-13T12:00:00.000Z', evidence: { description: null }, limitations: 'Single page only' };
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue({ ...pieceWithVariants, sourceFindingId: null, evidence: evidenceJson } as never);
    vi.mocked(generateContentVariant).mockResolvedValue(generatedVariant);
    vi.mocked(retryContentVariant).mockResolvedValue({ id: 'variant_1', index: 1 } as never);
    vi.mocked(db.contentPiece.findUnique).mockResolvedValue({ id: 'piece_1' } as never);

    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(200);
    expect(db.finding.findFirst).not.toHaveBeenCalled();
    expect(generateContentVariant).toHaveBeenCalledWith(expect.objectContaining({ sourceFinding: evidenceJson }), 1);
  });

  it('returns 409 without writing when the variant was already updated by a concurrent retry', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue(pieceWithVariants as never);
    vi.mocked(generateContentVariant).mockResolvedValue(generatedVariant);
    vi.mocked(retryContentVariant).mockRejectedValue(new ContentVariantRetryConflictError('Variant at index 1 was already updated'));

    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(409);
    expect(db.contentPiece.findUnique).not.toHaveBeenCalled();
  });

  it.each([0, 17])('persists a variant that failed again, charging only the %i measured retry tokens', async (tokenCost) => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue(pieceWithVariants as never);
    vi.mocked(generateContentVariant).mockResolvedValue({
      ...generatedVariant,
      status: 'failed',
      failureReason: CUSTOMER_SAFE_GENERATION_ERROR,
      tokenCost,
    });
    vi.mocked(retryContentVariant).mockResolvedValue({ id: 'variant_1', index: 1, status: 'failed', tokenCost } as never);
    vi.mocked(db.contentPiece.findUnique).mockResolvedValue({ id: 'piece_1' } as never);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });

    expect(retryContentVariant).toHaveBeenCalledWith('piece_1', 1, expect.objectContaining({
      status: 'failed',
      failureReason: CUSTOMER_SAFE_GENERATION_ERROR,
      tokenCost,
    }));
    expect(res.status).toBe(200);
    consoleErrorSpy.mockRestore();
  });

  it('returns 500 on an unexpected persistence error without leaking its message', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.contentPiece.findFirst).mockResolvedValue(pieceWithVariants as never);
    vi.mocked(generateContentVariant).mockResolvedValue(generatedVariant);
    vi.mocked(retryContentVariant).mockRejectedValue(new Error('connection terminated unexpectedly'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest({ index: 1 }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(500);
    const payload = await res.json();
    expect(JSON.stringify(payload)).not.toContain('connection terminated');
    consoleErrorSpy.mockRestore();
  });
});
