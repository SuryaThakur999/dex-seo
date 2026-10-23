import { describe, it, expect } from 'vitest';
import { linkedinAdapter } from './linkedin';
import { buildGroundingBlock, type DraftPromptInput } from '../adapter-types';
import { CONTENT_STRUCTURES } from '../playbook-shared';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: {
    brandVoice: 'Warm, direct',
    audience: 'SMB owners',
    approvedClaims: ['30-day guarantee'],
    restrictedWording: ['#1 rated'],
    markets: ['US'],
    languages: ['en'],
  },
  sourceAction: null,
  audience: null,
  objective: null,
  market: null,
  language: null,
};

describe('linkedinAdapter', () => {
  it('builds instructions with grounding rules, the structure playbook, and CTA guidance, but no per-request data', () => {
    const instructions = linkedinAdapter.buildInstructions();
    expect(instructions).toContain('Never invent facts');
    expect(instructions).toContain('professional');
    expect(instructions).toContain('PAS');
    expect(instructions).toContain('story');
    expect(instructions).toContain('contrarian');
    expect(instructions).not.toContain('spring sale');
  });

  it('includes the linkedin-skills hook formula and founder-angle library, and the em-dash/length rules', () => {
    const instructions = linkedinAdapter.buildInstructions();
    expect(instructions).toContain('Hook formulas');
    expect(instructions).toContain('Founder angle library');
    expect(instructions).toContain('one em dash');
    expect(instructions).toContain('900-1300 characters');
  });

  it('flags a body with more than 1 em dash per 100 words', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const bodyWithTwoEmDashes = `${words} — ${words} — ${words}`;
    const result = linkedinAdapter.validate({
      body: bodyWithTwoEmDashes,
      hook: 'Hook.',
      structure: 'PAS',
      cta: 'Comment below.',
      hashtags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('em dash'))).toBe(true);
  });

  it('accepts a body with no more than 1 em dash per 100 words', () => {
    const words = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');
    const bodyWithOneEmDash = `${words} — the point.`;
    const result = linkedinAdapter.validate({
      body: bodyWithOneEmDash,
      hook: 'Hook.',
      structure: 'PAS',
      cta: 'Comment below.',
      hashtags: [],
    });
    expect(result.issues.some((i) => i.includes('em dash'))).toBe(false);
  });

  it('flags the AI-flavored verb "leverage"', () => {
    const result = linkedinAdapter.validate({
      body: 'Leverage your network to find your next hire.',
      hook: 'Leverage your network.',
      structure: 'PAS',
      cta: 'Comment below.',
      hashtags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('banned AI-filler'))).toBe(true);
  });

  it('folds brand voice and topic into the untrusted grounding envelope', () => {
    const grounding = buildGroundingBlock(input);
    expect(grounding).toContain('Warm, direct');
    expect(grounding).toContain('spring sale');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({
      hook: 'Most SMBs waste their ad budget before noon.',
      body: 'Most SMBs waste their ad budget before noon. Check out our spring sale.',
      structure: 'PAS',
      cta: 'Comment with your biggest ad-spend mistake.',
      hashtags: ['sale', 'spring'],
    });
    expect(linkedinAdapter.parseModelOutput(raw)).toEqual({
      hook: 'Most SMBs waste their ad budget before noon.',
      body: 'Most SMBs waste their ad budget before noon. Check out our spring sale.',
      structure: 'PAS',
      cta: 'Comment with your biggest ad-spend mistake.',
      hashtags: ['sale', 'spring'],
    });
  });

  it('falls back to raw text as body when model output is not valid JSON', () => {
    const raw = 'Just a plain sentence, not JSON.';
    expect(linkedinAdapter.parseModelOutput(raw)).toEqual({ hook: '', body: raw, structure: '', cta: '', hashtags: [] });
  });

  it('flags an empty body as invalid', () => {
    const result = linkedinAdapter.validate({ body: '', hook: 'Hook.', structure: 'PAS', cta: 'Comment below.', hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Body is empty.');
  });

  it('flags a body over 3000 characters as invalid', () => {
    const result = linkedinAdapter.validate({
      body: 'a'.repeat(3001),
      hook: 'Hook.',
      structure: 'PAS',
      cta: 'Comment below.',
      hashtags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('3000'))).toBe(true);
  });

  it('flags a missing hook, missing structure, and missing CTA', () => {
    const result = linkedinAdapter.validate({ body: 'A fine post.', hook: '', structure: '', cta: '', hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('hook'))).toBe(true);
    expect(result.issues.some((i) => i.includes('structure'))).toBe(true);
    expect(result.issues.some((i) => i.includes('CTA'))).toBe(true);
  });

  it('flags a banned AI-filler phrase in the body', () => {
    const result = linkedinAdapter.validate({
      body: 'This is a total game-changer for your team.',
      hook: 'This is a total game-changer for your team.',
      structure: 'PAS',
      cta: 'Comment below.',
      hashtags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('banned AI-filler'))).toBe(true);
  });

  it('accepts a valid draft with hook, structure, and CTA present, and no banned phrases', () => {
    const result = linkedinAdapter.validate({
      body: 'Most SMBs waste their ad budget before noon. Check out our spring sale.',
      hook: 'Most SMBs waste their ad budget before noon.',
      structure: 'PAS',
      cta: 'Comment with your biggest ad-spend mistake.',
      hashtags: ['sale'],
    });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('golden: each of the three structures produces a valid draft with hook, structure, and CTA', () => {
    for (const structure of CONTENT_STRUCTURES) {
      const result = linkedinAdapter.validate({
        body: `Opening hook line for ${structure}. Body content follows.`,
        hook: `Opening hook line for ${structure}.`,
        structure,
        cta: 'Book a 15-minute call.',
        hashtags: ['sale'],
      });
      expect(result.valid).toBe(true);
    }
  });

  it('formats export as body plus hashtags with # prefix', () => {
    const text = linkedinAdapter.formatExport({
      body: 'A fine post.',
      hook: 'A fine post.',
      structure: 'PAS',
      cta: 'Comment below.',
      hashtags: ['sale', 'spring'],
    });
    expect(text).toBe('A fine post.\n\n#sale #spring');
  });

  it('formats export with no trailing hashtag line when there are none', () => {
    expect(
      linkedinAdapter.formatExport({ body: 'A fine post.', hook: 'A fine post.', structure: 'PAS', cta: 'Comment below.', hashtags: [] })
    ).toBe('A fine post.');
  });
});
