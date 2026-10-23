import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateContentVariant, generateContentVariants } from './generate-variants';
import { CUSTOMER_SAFE_GENERATION_ERROR } from '@/lib/customer-safe-error';
import { generateAndValidateContentPiece, type GenerateContentPieceInput } from './generate-and-validate';
import { ContentGenerationError } from './generation-error';

vi.mock('./generate-and-validate', () => ({ generateAndValidateContentPiece: vi.fn() }));

const input: GenerateContentPieceInput = {
  websiteId: 'site', platform: 'linkedin', topic: 'Topic', sourceAction: null,
  audience: null, objective: null, market: null, language: null,
  clientProfile: { id: 'profile', brandVoice: null, audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
};

describe('generateContentVariants', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('generates only the selected stable angle for a retry', async () => {
    vi.mocked(generateAndValidateContentPiece).mockResolvedValue({
      draft: {}, tokenCost: 9, status: 'needs_assets', failureReason: null, proofChecks: [],
    });
    const variant = await generateContentVariant(input, 2);
    expect(variant).toMatchObject({ index: 2, tokenCost: 9, status: 'needs_assets' });
    expect(generateAndValidateContentPiece).toHaveBeenCalledTimes(1);
    expect(generateAndValidateContentPiece).toHaveBeenCalledWith({ ...input, angleIndex: 2 });
  });

  it('redacts provider details while retaining measured failure usage', async () => {
    vi.mocked(generateAndValidateContentPiece).mockRejectedValue(
      new ContentGenerationError('OPENAI_API_KEY invalid: provider stack trace', 13),
    );
    const variants = await generateContentVariants(input);
    expect(variants.every(variant => variant.failureReason === CUSTOMER_SAFE_GENERATION_ERROR)).toBe(true);
    expect(variants.map(variant => variant.tokenCost)).toEqual([13, 13, 13]);
  });

  it('keeps stable angles and measured usage for drafts that pass critique', async () => {
    vi.mocked(generateAndValidateContentPiece).mockImplementation(async ({ angleIndex }) => ({
      draft: { hook: 'Check your next post', body: 'Review 3 supported facts. Read the checklist.', cta: 'Read the checklist.', structure: 'PAS', hashtags: [] }, tokenCost: 10 + angleIndex!,
      status: 'draft', failureReason: null, proofChecks: [],
    }));
    const variants = await generateContentVariants(input);
    expect(variants.map(v => v.index)).toEqual([0, 1, 2]);
    expect(new Set(variants.map(v => v.angle)).size).toBe(3);
    expect(variants.map(v => v.tokenCost)).toEqual([10, 11, 12]);
    expect(variants.every(v => v.status === 'draft' && v.failureReason === null)).toBe(true);
    expect(variants.every(v => (v.critique as { score: number }).score === 100)).toBe(true);
    expect(vi.mocked(generateAndValidateContentPiece).mock.calls.map(([value]) => value)).toEqual(
      [0, 1, 2].map(angleIndex => ({ ...input, angleIndex })),
    );
  });

  it('bounds revision to one attempt and charges both calls when critique still fails', async () => {
    vi.mocked(generateAndValidateContentPiece).mockResolvedValue({
      draft: { hook: 'Check your next post', body: 'Read the checklist.', cta: 'Read the checklist.', structure: 'PAS', hashtags: [] },
      tokenCost: 7, status: 'draft', failureReason: null, proofChecks: [],
    });
    const variants = await generateContentVariants(input);
    expect(generateAndValidateContentPiece).toHaveBeenCalledTimes(6);
    expect(variants.every(v => v.status === 'needs_review' && v.tokenCost === 14)).toBe(true);
    expect(variants.every(v => (v.critique as { fixes: unknown[] }).fixes.length > 0)).toBe(true);
  });

  it('retains original and failed revision usage without affecting other variants', async () => {
    vi.mocked(generateAndValidateContentPiece).mockImplementation(async (_input, revision) => {
      if (revision) throw new ContentGenerationError('Revision parse failed', 5);
      return { draft: { hook: 'Check your post', body: 'Read the checklist.', cta: 'Read it.', structure: 'PAS', hashtags: [] }, tokenCost: 7, status: 'draft', failureReason: null, proofChecks: [] };
    });
    expect((await generateContentVariants(input)).every(v => v.status === 'failed' && v.tokenCost === 12)).toBe(true);
  });

  it('persists the revised draft and its new critique with cumulative usage', async () => {
    const original = { hook: 'Check your next post', body: 'Read the checklist.', cta: 'Read it.', structure: 'PAS', hashtags: [] };
    const revised = { ...original, body: 'Review 3 supported facts. Read the checklist.' };
    vi.mocked(generateAndValidateContentPiece).mockImplementation(async (_input, revision) => {
      if (revision) {
        expect(JSON.parse(revision.fullText)).toEqual(original);
        expect(revision.critique.fixes.some(fix => fix.category === 'specificity')).toBe(true);
      }
      return { draft: revision ? revised : original, tokenCost: revision ? 5 : 7, status: 'draft', failureReason: null, proofChecks: [] };
    });
    const variants = await generateContentVariants(input);
    expect(generateAndValidateContentPiece).toHaveBeenCalledTimes(6);
    for (const variant of variants) {
      expect(variant).toMatchObject({ draftContent: revised, tokenCost: 12, status: 'draft', critique: { score: 100, fixes: [] } });
    }
  });

  it.each(['needs_assets', 'needs_review'] as const)('preserves the %s gate on a revised draft', async (status) => {
    vi.mocked(generateAndValidateContentPiece).mockImplementation(async (_input, revision) => ({
      draft: { hook: 'Check your next post', body: 'Read the checklist.', cta: 'Read it.', structure: 'PAS', hashtags: [] },
      tokenCost: revision ? 5 : 7, status: revision ? status : 'draft',
      failureReason: revision ? 'Revision gated' : null, proofChecks: [],
    }));
    const variants = await generateContentVariants(input);
    expect(generateAndValidateContentPiece).toHaveBeenCalledTimes(6);
    expect(variants.every(v => v.status === status && v.tokenCost === 12 && v.critique === null && v.failureReason === 'Revision gated')).toBe(true);
  });

  it('isolates failures and preserves asset and proof gates', async () => {
    vi.mocked(generateAndValidateContentPiece)
      .mockRejectedValueOnce(new ContentGenerationError('Parse failed', 17))
      .mockResolvedValueOnce({ draft: { body: 'Incomplete' }, tokenCost: 23, status: 'needs_assets', failureReason: null, proofChecks: null })
      .mockResolvedValueOnce({ draft: { body: 'Restricted' }, tokenCost: 31, status: 'needs_review', failureReason: 'ProofLayer fail', proofChecks: [] });
    const variants = await generateContentVariants(input);
    expect(variants[0]).toMatchObject({ index: 0, draftContent: {}, status: 'failed', tokenCost: 17, failureReason: CUSTOMER_SAFE_GENERATION_ERROR });
    expect(variants[1]).toMatchObject({ status: 'needs_assets', tokenCost: 23, failureReason: null });
    expect(variants[2]).toMatchObject({ status: 'needs_review', tokenCost: 31, failureReason: 'ProofLayer fail' });
  });

  it('does not invent usage for an unmeasured provider failure', async () => {
    vi.mocked(generateAndValidateContentPiece).mockRejectedValue(new Error('Provider unavailable'));
    expect((await generateContentVariants(input)).map(v => v.tokenCost)).toEqual([0, 0, 0]);
  });
});
