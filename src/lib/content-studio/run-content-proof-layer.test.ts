import { describe, it, expect } from 'vitest';
import { runContentProofLayer } from './run-content-proof-layer';

function baseInput(overrides: Partial<Parameters<typeof runContentProofLayer>[0]> = {}) {
  return {
    platform: 'linkedin' as const,
    draftText: 'A short, honest post about our product update.',
    rawDraft: {},
    approvedFacts: [],
    restrictedWording: [],
    recentDraftTexts: [],
    ...overrides,
  };
}

describe('runContentProofLayer', () => {
  it('passes a clean draft with no platform policy attached', () => {
    const result = runContentProofLayer(baseInput());
    expect(result.outcome).toBe('pass');
    expect(result.checksRun.find((c) => c.check === 'reddit-target-community')).toBeUndefined();
  });

  it('blocks a draft containing restricted wording', () => {
    const result = runContentProofLayer(
      baseInput({ draftText: 'Our guaranteed-lowest-price offer.', restrictedWording: ['guaranteed-lowest-price'] })
    );
    expect(result.outcome).toBe('block');
  });

  it('upgrades a clean pass to flag when the Reddit policy check fails', () => {
    const result = runContentProofLayer(
      baseInput({ platform: 'reddit', rawDraft: { title: 't', body: 'b', suggestedSubreddits: [] } })
    );
    expect(result.outcome).toBe('flag');
    expect(result.checksRun.find((c) => c.check === 'reddit-target-community')?.result).toBe('fail');
  });

  it('never downgrades an existing block to flag when the policy check also fails', () => {
    const result = runContentProofLayer(
      baseInput({
        platform: 'reddit',
        draftText: 'Our guaranteed-lowest-price offer.',
        restrictedWording: ['guaranteed-lowest-price'],
        rawDraft: { title: 't', body: 'b', suggestedSubreddits: [] },
      })
    );
    expect(result.outcome).toBe('block');
    expect(result.checksRun.find((c) => c.check === 'reddit-target-community')?.result).toBe('fail');
    expect(result.checksRun.find((c) => c.check === 'no-restricted-wording')?.result).toBe('fail');
  });

  it('passes a Reddit draft with a suggested subreddit', () => {
    const result = runContentProofLayer(
      baseInput({ platform: 'reddit', rawDraft: { title: 't', body: 'b', suggestedSubreddits: ['r/smallbusiness'] } })
    );
    expect(result.outcome).toBe('pass');
    expect(result.checksRun.find((c) => c.check === 'reddit-target-community')?.result).toBe('pass');
  });
});
