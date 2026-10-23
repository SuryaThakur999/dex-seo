import { describe, it, expect } from 'vitest';
import { facebookAdapter } from './facebook';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Friendly', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('facebookAdapter', () => {
  it('builds instructions with a casual-tone directive', () => {
    expect(facebookAdapter.buildInstructions()).toContain('casual');
  });

  it('folds the topic into the untrusted grounding envelope', () => {
    expect(buildGroundingBlock(input)).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ body: 'Spring sale time!', hashtags: ['sale'] });
    expect(facebookAdapter.parseModelOutput(raw)).toEqual({ body: 'Spring sale time!', hashtags: ['sale'] });
  });

  it('falls back to raw text on invalid JSON', () => {
    expect(facebookAdapter.parseModelOutput('not json')).toEqual({ body: 'not json', hashtags: [] });
  });

  it('flags an empty body as invalid', () => {
    const result = facebookAdapter.validate({ body: '', hashtags: [] });
    expect(result.valid).toBe(false);
  });

  it('accepts a very long body under the 63206 character practical cap', () => {
    const result = facebookAdapter.validate({ body: 'a'.repeat(10000), hashtags: [] });
    expect(result.valid).toBe(true);
  });

  it('rejects a body over 63206 characters', () => {
    const result = facebookAdapter.validate({ body: 'a'.repeat(63207), hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('63206');
  });

  it('formats export as body plus hashtags', () => {
    expect(facebookAdapter.formatExport({ body: 'Spring sale!', hashtags: ['sale'] })).toBe('Spring sale!\n\n#sale');
  });
});
