import { describe, it, expect, vi } from 'vitest';
import { draftInternalLinkFix, INTERNAL_LINK_FIX_ACTION_TYPE, INTERNAL_LINK_FIX_RULE_IDS, parseInternalLinkSuggestions } from './internal-link-fix';

describe('parseInternalLinkSuggestions', () => {
  it('parses one or more "url | anchor text" lines', () => {
    const draft = '/blog/guide | our full guide\nhttps://example.com/pricing | see pricing';
    expect(parseInternalLinkSuggestions(draft)).toEqual([
      { url: '/blog/guide', anchorText: 'our full guide' },
      { url: 'https://example.com/pricing', anchorText: 'see pricing' },
    ]);
  });

  it('returns an empty list for the plain "nothing relevant" sentence', () => {
    expect(parseInternalLinkSuggestions('No existing pages are topically relevant to this one.')).toEqual([]);
  });

  it('drops a malformed line (missing url or anchor text) instead of fabricating an entry', () => {
    const draft = '/blog/guide | our full guide\n|no url\nno anchor |\njust text with no separator';
    expect(parseInternalLinkSuggestions(draft)).toEqual([{ url: '/blog/guide', anchorText: 'our full guide' }]);
  });

  it('returns an empty list for empty input', () => {
    expect(parseInternalLinkSuggestions('')).toEqual([]);
  });
});

describe('draftInternalLinkFix', () => {
  it('sends the target page and candidates through the untrusted-data envelope and returns the model output', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '/blog/guide | our full guide', totalTokens: 30 });
    const target = { url: 'https://example.com/orphan', title: 'Orphan Page' };
    const candidates = [{ url: 'https://example.com/blog/guide', title: 'Complete Guide' }];

    const result = await draftInternalLinkFix(target, candidates, callOpenAI);

    expect(callOpenAI).toHaveBeenCalledWith(
      expect.stringContaining('internal link'),
      expect.stringContaining('Orphan Page')
    );
    expect(result).toEqual({ draftContent: '/blog/guide | our full guide', tokenCost: 30 });
  });

  it('includes every candidate in the untrusted user message, not just the first', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'x', totalTokens: 1 });
    const target = { url: 'https://example.com/orphan', title: 'Orphan' };
    const candidates = [
      { url: 'https://example.com/a', title: 'Page A' },
      { url: 'https://example.com/b', title: 'Page B' },
    ];

    await draftInternalLinkFix(target, candidates, callOpenAI);

    const [, userPrompt] = callOpenAI.mock.calls[0];
    expect(userPrompt).toContain('Page A');
    expect(userPrompt).toContain('Page B');
  });

  it('keeps the target page title and candidate titles out of the trusted system prompt', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'x', totalTokens: 1 });
    const target = { url: 'https://example.com/orphan', title: 'Very Specific Orphan Title' };
    const candidates = [{ url: 'https://example.com/a', title: 'Very Specific Candidate Title' }];

    await draftInternalLinkFix(target, candidates, callOpenAI);

    const [systemPrompt] = callOpenAI.mock.calls[0];
    expect(systemPrompt).not.toContain('Very Specific Orphan Title');
    expect(systemPrompt).not.toContain('Very Specific Candidate Title');
  });

  it('handles a null target title without inventing one', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'x', totalTokens: 1 });

    await draftInternalLinkFix({ url: 'https://example.com/orphan', title: null }, [], callOpenAI);

    const [, userPrompt] = callOpenAI.mock.calls[0];
    expect(userPrompt).toContain('no title found');
  });

  it('throws if the model returns empty content', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '', totalTokens: 1 });

    await expect(
      draftInternalLinkFix({ url: 'https://example.com/orphan', title: 'x' }, [], callOpenAI)
    ).rejects.toThrow('failed validation');
  });
});

describe('constants', () => {
  it('exposes the rule ID and actionType used to create/dedup these Actions', () => {
    expect(INTERNAL_LINK_FIX_RULE_IDS).toEqual(['zero_internal_links']);
    expect(INTERNAL_LINK_FIX_ACTION_TYPE).toBe('internal_link_fix');
  });
});
