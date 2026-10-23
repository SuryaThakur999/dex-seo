import { describe, it, expect, vi } from 'vitest';
import { draftMetaDescription } from '@/lib/creation-engine';
import { draftRestrictedWordingFix } from '@/lib/restricted-wording-fix';
import { draftInternalLinkFix } from '@/lib/internal-link-fix';
import { generateContentDraft } from '@/lib/content-studio/draft-generator';
import { getAdapter } from '@/lib/content-studio/registry';

// Phase 1E, Part E #4: a validation failure must never reach persistence dressed as a success.
// Each of these four generator functions is the one place a bad model response could turn into
// a customer-visible "succeeded" Action/ContentPiece -- this asserts every one of them throws
// (never resolves with a value) on empty or oversized output, so every real caller's existing
// catch block (already covered by run-scan.test.ts, retry-draft's route.test.ts,
// generation-worker.test.ts, and content-studio/drafts/route.test.ts) is the only path a
// customer-visible failure state can come from. Historical Action/ContentPiece rendering is
// covered by the existing, unmodified action-detail.test.tsx and content-studio export tests,
// which this change doesn't touch and which still pass in the full suite.

describe('output-contract: a validation failure never resolves as a success', () => {
  it('draftMetaDescription rejects rather than returning empty/oversized draftContent', async () => {
    const page = { url: 'https://example.com/p', title: 't', metaDescription: null, h1: null };
    await expect(draftMetaDescription(page, vi.fn().mockResolvedValue({ content: '', totalTokens: 1 }))).rejects.toThrow();
    await expect(
      draftMetaDescription(page, vi.fn().mockResolvedValue({ content: 'x'.repeat(500), totalTokens: 1 }))
    ).rejects.toThrow();
  });

  it('draftRestrictedWordingFix rejects rather than returning empty/oversized draftContent', async () => {
    const matches = [{ phrase: 'p', excerpt: 'e' }];
    await expect(draftRestrictedWordingFix(matches, vi.fn().mockResolvedValue({ content: '', totalTokens: 1 }))).rejects.toThrow();
    await expect(
      draftRestrictedWordingFix(matches, vi.fn().mockResolvedValue({ content: 'x'.repeat(5000), totalTokens: 1 }))
    ).rejects.toThrow();
  });

  it('draftInternalLinkFix rejects rather than returning empty/oversized draftContent', async () => {
    const target = { url: 'https://example.com/t', title: 't' };
    const candidates = [{ url: 'https://example.com/c', title: 'c' }];
    await expect(draftInternalLinkFix(target, candidates, vi.fn().mockResolvedValue({ content: '', totalTokens: 1 }))).rejects.toThrow();
    await expect(
      draftInternalLinkFix(target, candidates, vi.fn().mockResolvedValue({ content: 'x'.repeat(5000), totalTokens: 1 }))
    ).rejects.toThrow();
  });

  it('generateContentDraft rejects rather than returning an empty draft, for every registered platform', async () => {
    const adapter = getAdapter('linkedin');
    const input = { topic: 't', clientProfile: { brandVoice: null, audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] }, sourceAction: null, audience: null, objective: null, market: null, language: null };
    await expect(generateContentDraft(adapter, input as never, vi.fn().mockResolvedValue({ content: '', totalTokens: 1 }))).rejects.toThrow();
  });
});
