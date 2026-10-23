import { describe, it, expect } from 'vitest';
import { runProofLayer, decideActionStatus, deriveRiskTier, type ProofLayerInput } from './proof-layer';

function baseInput(overrides: Partial<ProofLayerInput> = {}): ProofLayerInput {
  return {
    draftContent: 'Shop our range of blue widgets, built to last and ready to ship today.',
    sourceContent: { title: 'Blue Widgets', metaDescription: null },
    aiDisclosure: true,
    recentDraftsForCustomer: [],
    approvedFacts: [],
    ...overrides,
  };
}

describe('runProofLayer', () => {
  describe('AI-content disclosure', () => {
    it('blocks when the disclosure flag is missing', () => {
      const result = runProofLayer(baseInput({ aiDisclosure: false }));
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'ai-content-disclosure')?.result).toBe('fail');
    });

    it('passes when the disclosure flag is attached', () => {
      const result = runProofLayer(baseInput({ aiDisclosure: true }));
      expect(result.checksRun.find((c) => c.check === 'ai-content-disclosure')?.result).toBe('pass');
    });
  });

  describe('no unverifiable factual claims', () => {
    it('blocks a draft with a "#1" claim not present in the source', () => {
      const result = runProofLayer(
        baseInput({ draftContent: 'The #1 rated blue widgets on the market today.' })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });

    it('blocks a draft with an invented percentage not present in the source', () => {
      const result = runProofLayer(baseInput({ draftContent: 'Widgets rated 43% faster than the rest.' }));
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });

    it('passes a draft with no invented numbers or superlatives', () => {
      const result = runProofLayer(baseInput({ draftContent: 'Shop our range of blue widgets, in stock now.' }));
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('pass');
    });

    it('passes a claim that IS present in the source content', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'The #1 choice for blue widgets.',
          sourceContent: { title: 'The #1 choice for blue widgets', metaDescription: null },
        })
      );
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('pass');
    });

    it('blocks a draft with an invented "award-winning" claim not present in the source', () => {
      const result = runProofLayer(baseInput({ draftContent: 'Our award-winning blue widgets, built to last.' }));
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });

    it('blocks a draft with an invented customer-count claim not present in the source', () => {
      const result = runProofLayer(baseInput({ draftContent: 'Trusted by 50,000 businesses worldwide.' }));
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });

    it('passes a claim phrased with different punctuation than the source, when the source genuinely supports it', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'The top-rated choice for blue widgets.',
          sourceContent: { title: 'The top rated choice for blue widgets', metaDescription: null },
        })
      );
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('pass');
    });

    it('still blocks a "#1" claim when the source merely contains an unrelated year', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'The #1 rated blue widgets.',
          sourceContent: { title: 'Blue Widgets since 2019', metaDescription: null },
        })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });

    it('still blocks a percentage claim when the source merely contains an unrelated number', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'Widgets rated 43% faster than the rest.',
          sourceContent: { title: 'Founded in 1943', metaDescription: null },
        })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });
  });

  describe('no contradiction of source content', () => {
    it('blocks a draft claiming "in stock" when the source says out of stock', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'Blue widgets, in stock and ready to ship.',
          sourceContent: { title: 'Blue Widgets', metaDescription: 'Currently out of stock.' },
        })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-contradiction')?.result).toBe('fail');
    });

    it('passes a draft that only restates what is actually on the page', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'Blue widgets, currently out of stock — check back soon.',
          sourceContent: { title: 'Blue Widgets', metaDescription: 'Currently out of stock.' },
        })
      );
      expect(result.checksRun.find((c) => c.check === 'no-contradiction')?.result).toBe('pass');
    });
  });

  describe('length/format validity', () => {
    it('flags a draft over 155 characters', () => {
      const result = runProofLayer(baseInput({ draftContent: 'x'.repeat(200) }));
      expect(result.outcome).toBe('flag');
      expect(result.checksRun.find((c) => c.check === 'length-format')?.result).toBe('fail');
    });

    it('passes a draft within range', () => {
      const result = runProofLayer(baseInput({ draftContent: 'A reasonably sized meta description.' }));
      expect(result.checksRun.find((c) => c.check === 'length-format')?.result).toBe('pass');
    });
  });

  describe('duplicate-risk', () => {
    it('flags a near-duplicate of another recent draft for the same customer', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'Shop our range of blue widgets, built to last and ready to ship today.',
          recentDraftsForCustomer: ['Shop our range of blue widgets, built to last and ready to ship this week.'],
        })
      );
      expect(result.outcome).toBe('flag');
      expect(result.checksRun.find((c) => c.check === 'duplicate-risk')?.result).toBe('fail');
    });

    it('passes two drafts with genuinely distinct content', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'Shop our range of blue widgets, built to last and ready to ship today.',
          recentDraftsForCustomer: ['Browse our catalog of premium red gadgets, handcrafted in small batches.'],
        })
      );
      expect(result.checksRun.find((c) => c.check === 'duplicate-risk')?.result).toBe('pass');
    });
  });

  describe('outcome aggregation', () => {
    it('returns pass with all-pass reasoning when every check passes', () => {
      const result = runProofLayer(baseInput());
      expect(result.outcome).toBe('pass');
      expect(result.reasoning).toBe('All checks passed.');
      expect(result.checksRun).toHaveLength(6);
    });

    it('prioritizes block over flag when both a hard-fail and a soft-fail are present', () => {
      const result = runProofLayer(baseInput({ aiDisclosure: false, draftContent: 'x'.repeat(200) }));
      expect(result.outcome).toBe('block');
    });
  });

  describe('decideActionStatus', () => {
    it.each([
      ['pass', true, 'approved'],
      ['pass', false, 'pending'],
      ['flag', true, 'pending'],
      ['flag', false, 'pending'],
      ['block', true, 'pending'],
      ['block', false, 'pending'],
    ] as const)('outcome=%s, autoExecuteEnabled=%s → status=%s', (outcome, autoExecuteEnabled, expected) => {
      expect(decideActionStatus(outcome, autoExecuteEnabled)).toBe(expected);
    });
  });

  describe('approved facts as a second source of truth', () => {
    it('passes a claim that appears in an approved fact, not the page content', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'The #1 choice for blue widgets.',
          approvedFacts: ['Voted #1 blue widget supplier by Trade Weekly, 2026'],
        })
      );
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('pass');
    });

    it('blocks a draft that contradicts an approved fact even when the page itself is silent', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'Blue widgets, in stock and ready to ship.',
          sourceContent: { title: 'Blue Widgets', metaDescription: null },
          approvedFacts: ['Currently out of stock — restocking in April'],
        })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-contradiction')?.result).toBe('fail');
    });
  });

  describe('restricted wording', () => {
    it('blocks a draft that contains a restricted term', () => {
      const result = runProofLayer(
        baseInput({
          draftContent: 'Our guaranteed-lowest-price blue widgets beat the competitor.',
          restrictedWording: ['guaranteed-lowest-price'],
        })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-restricted-wording')?.result).toBe('fail');
    });

    it('passes when no restricted term appears', () => {
      const result = runProofLayer(baseInput({ restrictedWording: ['guaranteed-lowest-price'] }));
      expect(result.checksRun.find((c) => c.check === 'no-restricted-wording')?.result).toBe('pass');
    });

    it('passes trivially when restrictedWording is omitted — existing callers stay unaffected', () => {
      const result = runProofLayer(baseInput());
      expect(result.checksRun.find((c) => c.check === 'no-restricted-wording')?.result).toBe('pass');
    });
  });
});

describe('deriveRiskTier', () => {
  it('returns high when AI disclosure is missing', () => {
    const result = runProofLayer(baseInput({ aiDisclosure: false }));
    expect(deriveRiskTier(result.checksRun)).toBe('high');
  });

  it('returns high when the draft contradicts the source', () => {
    const result = runProofLayer(
      baseInput({
        draftContent: 'In stock now.',
        sourceContent: { title: 'Widgets', metaDescription: 'Out of stock.' },
      })
    );
    expect(deriveRiskTier(result.checksRun)).toBe('high');
  });

  it('returns medium for an unverifiable claim with no contradiction or disclosure issue', () => {
    const result = runProofLayer(baseInput({ draftContent: 'The #1 choice for blue widgets.' }));
    expect(deriveRiskTier(result.checksRun)).toBe('medium');
  });

  it('returns low when every check passes', () => {
    const result = runProofLayer(baseInput());
    expect(deriveRiskTier(result.checksRun)).toBe('low');
  });

  it('returns low for a length-only flag', () => {
    const result = runProofLayer(baseInput({ draftContent: 'x'.repeat(200) }));
    expect(deriveRiskTier(result.checksRun)).toBe('low');
  });
});
