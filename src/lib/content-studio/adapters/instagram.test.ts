import { describe, it, expect } from 'vitest';
import { instagramAdapter } from './instagram';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';
import { CONTENT_STRUCTURES } from '../playbook-shared';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Visual, upbeat', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('instagramAdapter', () => {
  it('builds instructions requiring alt text, the structure playbook, and a CTA', () => {
    const instructions = instagramAdapter.buildInstructions();
    expect(instructions).toContain('altText');
    expect(instructions).toContain('PAS');
    expect(instructions).toContain('contrarian');
  });

  it('folds the topic into the untrusted grounding envelope', () => {
    expect(buildGroundingBlock(input)).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({
      hook: 'Spring sale!',
      caption: 'Spring sale! Save all week.',
      structure: 'story',
      cta: 'Tap the link in bio.',
      hashtags: ['sale'],
      altText: 'A spring sale banner.',
    });
    expect(instagramAdapter.parseModelOutput(raw)).toEqual({
      hook: 'Spring sale!',
      caption: 'Spring sale! Save all week.',
      structure: 'story',
      cta: 'Tap the link in bio.',
      hashtags: ['sale'],
      altText: 'A spring sale banner.',
    });
  });

  it('falls back to raw text as caption on invalid JSON, with empty fields', () => {
    expect(instagramAdapter.parseModelOutput('not json')).toEqual({
      hook: '',
      caption: 'not json',
      structure: '',
      cta: '',
      hashtags: [],
      altText: '',
    });
  });

  it('flags missing alt text as invalid, for accessibility', () => {
    const result = instagramAdapter.validate({
      hook: 'Hook.',
      caption: 'Spring sale!',
      structure: 'PAS',
      cta: 'Save this post.',
      hashtags: ['sale'],
      altText: '',
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('alt text'))).toBe(true);
  });

  it('flags an empty caption as invalid', () => {
    const result = instagramAdapter.validate({ hook: '', caption: '', structure: '', cta: '', hashtags: [], altText: 'A banner.' });
    expect(result.valid).toBe(false);
  });

  it('flags a banned AI-filler phrase in the caption', () => {
    const result = instagramAdapter.validate({
      hook: 'Unlock your best spring yet.',
      caption: 'Unlock your best spring yet.',
      structure: 'PAS',
      cta: 'Save this post.',
      hashtags: ['sale'],
      altText: 'A banner.',
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('banned AI-filler'))).toBe(true);
  });

  it('accepts a caption with hook, structure, CTA, and alt text present', () => {
    const result = instagramAdapter.validate({
      hook: 'Spring sale!',
      caption: 'Spring sale! Save all week.',
      structure: 'story',
      cta: 'Tap the link in bio.',
      hashtags: ['sale'],
      altText: 'A banner.',
    });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('golden: each of the three structures produces a valid draft with hook, structure, and CTA', () => {
    for (const structure of CONTENT_STRUCTURES) {
      const result = instagramAdapter.validate({
        hook: `Opening line for ${structure}.`,
        caption: `Opening line for ${structure}. Caption body.`,
        structure,
        cta: 'Save this post.',
        hashtags: ['sale'],
        altText: 'A banner.',
      });
      expect(result.valid).toBe(true);
    }
  });

  it('formats export as caption, hashtags, and an alt-text note', () => {
    const text = instagramAdapter.formatExport({
      hook: 'Spring sale!',
      caption: 'Spring sale!',
      structure: 'PAS',
      cta: 'Save this post.',
      hashtags: ['sale'],
      altText: 'A banner.',
    });
    expect(text).toBe('Spring sale!\n\n#sale\n\n(Alt text for accessibility: A banner.)');
  });
});
