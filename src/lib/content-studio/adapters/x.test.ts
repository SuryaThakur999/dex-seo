import { describe, it, expect } from 'vitest';
import { xAdapter } from './x';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Punchy', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('xAdapter', () => {
  it('builds instructions mentioning the 280 character hard cap', () => {
    expect(xAdapter.buildInstructions()).toContain('280');
  });

  it('folds the topic into the untrusted grounding envelope', () => {
    expect(buildGroundingBlock(input)).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ body: 'Spring sale is live.', hashtags: ['sale'] });
    expect(xAdapter.parseModelOutput(raw)).toEqual({ body: 'Spring sale is live.', hashtags: ['sale'] });
  });

  it('falls back to raw text on invalid JSON', () => {
    expect(xAdapter.parseModelOutput('not json')).toEqual({ body: 'not json', hashtags: [] });
  });

  it('rejects a body over 280 characters', () => {
    const result = xAdapter.validate({ body: 'a'.repeat(281), hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('280');
  });

  it('accepts a body at exactly 280 characters', () => {
    const result = xAdapter.validate({ body: 'a'.repeat(280), hashtags: [] });
    expect(result.valid).toBe(true);
  });

  it('formats export as body plus hashtags', () => {
    expect(xAdapter.formatExport({ body: 'Spring sale.', hashtags: ['sale'] })).toBe('Spring sale.\n\n#sale');
  });

  it('parses a thread while keeping its opening available as the body', () => {
    expect(xAdapter.parseModelOutput(JSON.stringify({ posts: ['Opening.', 'Details.'], hashtags: [] })))
      .toEqual({ body: 'Opening.', posts: ['Opening.', 'Details.'], hashtags: [] });
  });

  it('exports every post with hashtags on the final post', () => {
    expect(xAdapter.formatExport({ body: 'Opening.', posts: ['Opening.', 'Details.'], hashtags: ['sale'] }))
      .toBe('Opening.\n\n---\n\nDetails.\n\n#sale');
  });

  it('rejects an overlong post anywhere in a thread', () => {
    expect(xAdapter.validate({ body: 'Opening.', posts: ['Opening.', 'a'.repeat(281)], hashtags: [] }).valid).toBe(false);
  });

  it('counts hashtags toward the final post character limit', () => {
    expect(xAdapter.validate({ body: 'a'.repeat(280), hashtags: ['sale'] }).valid).toBe(false);
  });

  it.each([
    { posts: [] },
    { posts: ['Only one.'] },
    { posts: ['Opening.', ''] },
    { posts: ['Opening.', 42] },
    { posts: null },
  ])('rejects malformed thread posts $posts', ({ posts }) => {
    const draft = xAdapter.parseModelOutput(JSON.stringify({ body: 'Fallback.', posts, hashtags: [] }));
    expect(xAdapter.validate(draft).valid).toBe(false);
  });
});
