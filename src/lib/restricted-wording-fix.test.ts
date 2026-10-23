import { describe, it, expect, vi } from 'vitest';
import { draftRestrictedWordingFix, RESTRICTED_WORDING_FIX_ACTION_TYPE } from './restricted-wording-fix';

describe('draftRestrictedWordingFix', () => {
  it('sends the excerpts through the untrusted-data envelope and returns the model output', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'A safe rewrite.', totalTokens: 42 });
    const matches = [{ phrase: 'guaranteed results', excerpt: 'We offer guaranteed results for every customer.' }];

    const result = await draftRestrictedWordingFix(matches, callOpenAI);

    expect(callOpenAI).toHaveBeenCalledWith(
      expect.stringContaining('restricted wording'),
      expect.stringContaining('guaranteed results')
    );
    expect(result).toEqual({ draftContent: 'A safe rewrite.', tokenCost: 42 });
  });

  it('folds every match into the untrusted user message, not just the first', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'Two rewrites.', totalTokens: 10 });
    const matches = [
      { phrase: '#1 rated', excerpt: 'We are the #1 rated provider.' },
      { phrase: 'risk-free', excerpt: 'Try it risk-free today.' },
    ];

    await draftRestrictedWordingFix(matches, callOpenAI);

    const [, userPrompt] = callOpenAI.mock.calls[0];
    expect(userPrompt).toContain('#1 rated');
    expect(userPrompt).toContain('risk-free');
  });

  it('keeps the excerpt content out of the trusted system prompt', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'Rewrite.', totalTokens: 5 });
    const matches = [{ phrase: 'unbeatable price', excerpt: 'Our unbeatable price beats everyone.' }];

    await draftRestrictedWordingFix(matches, callOpenAI);

    const [systemPrompt] = callOpenAI.mock.calls[0];
    expect(systemPrompt).not.toContain('unbeatable price');
  });

  it('throws if the model returns empty content', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '', totalTokens: 3 });
    const matches = [{ phrase: 'x', excerpt: 'y' }];

    await expect(draftRestrictedWordingFix(matches, callOpenAI)).rejects.toThrow('failed validation');
  });
});

describe('RESTRICTED_WORDING_FIX_ACTION_TYPE', () => {
  it('is the actionType string used to create/dedup these Actions', () => {
    expect(RESTRICTED_WORDING_FIX_ACTION_TYPE).toBe('restricted_wording_fix');
  });
});
