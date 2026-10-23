import { describe, it, expect } from 'vitest';
import {
  CONTENT_STRUCTURES,
  isContentStructure,
  findBannedPhrases,
  validatePlaybookFields,
  emDashesPerHundredWords,
} from './playbook-shared';

describe('isContentStructure', () => {
  it('accepts the three defined structures', () => {
    for (const s of CONTENT_STRUCTURES) expect(isContentStructure(s)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isContentStructure('story-ish')).toBe(false);
    expect(isContentStructure('')).toBe(false);
    expect(isContentStructure(undefined)).toBe(false);
  });
});

describe('findBannedPhrases', () => {
  it('finds a banned AI-filler phrase, case-insensitively', () => {
    expect(findBannedPhrases('This is a GAME-CHANGER for your team.')).toContain('game-changer');
  });

  it('returns an empty array for clean text', () => {
    expect(findBannedPhrases('We shipped a fix for the checkout bug yesterday.')).toEqual([]);
  });
});

describe('validatePlaybookFields', () => {
  it.each([undefined, null, 42, {}])('flags malformed acceptance fields (%s) without throwing', (value) => {
    const issues = validatePlaybookFields({
      hook: value,
      structure: value,
      cta: value,
      fullText: 'Body text.',
    });
    expect(issues).toHaveLength(3);
    expect(issues.some((issue) => issue.includes('hook'))).toBe(true);
    expect(issues.some((issue) => issue.includes('structure'))).toBe(true);
    expect(issues.some((issue) => issue.includes('CTA'))).toBe(true);
    expect(validatePlaybookFields({ hook: 'Hook.', structure: 'PAS', cta: value, fullText: 'Body text.' }))
      .toEqual(['Missing a CTA.']);
  });

  it('flags missing hook, structure, and CTA', () => {
    const issues = validatePlaybookFields({ hook: '', structure: '', cta: '', fullText: 'Body text.' });
    expect(issues.some((i) => i.includes('hook'))).toBe(true);
    expect(issues.some((i) => i.includes('structure'))).toBe(true);
    expect(issues.some((i) => i.includes('CTA'))).toBe(true);
  });

  it('flags an invalid structure value', () => {
    const issues = validatePlaybookFields({ hook: 'Hook.', structure: 'listicle', cta: 'Comment below.', fullText: 'Body text.' });
    expect(issues.some((i) => i.includes('structure'))).toBe(true);
  });

  it('passes with hook, a valid structure, CTA, and no banned phrases', () => {
    const issues = validatePlaybookFields({ hook: 'Hook.', structure: 'PAS', cta: 'Comment below.', fullText: 'Body text.' });
    expect(issues).toEqual([]);
  });

  it('flags a banned phrase found anywhere in fullText', () => {
    const issues = validatePlaybookFields({
      hook: 'Hook.',
      structure: 'PAS',
      cta: 'Comment below.',
      fullText: 'Let us delve into the details.',
    });
    expect(issues.some((i) => i.includes('banned AI-filler'))).toBe(true);
  });
});

describe('emDashesPerHundredWords', () => {
  it('returns 0 for text with no em dashes', () => {
    expect(emDashesPerHundredWords('A plain sentence with no special punctuation.')).toBe(0);
  });

  it('returns 0 for empty text', () => {
    expect(emDashesPerHundredWords('')).toBe(0);
  });

  it('computes density proportional to word count', () => {
    const words = Array.from({ length: 99 }, (_, i) => `w${i}`).join(' ');
    expect(emDashesPerHundredWords(`${words} —`)).toBe(1);
  });
});
