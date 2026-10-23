import { describe, expect, it } from 'vitest';
import { critiqueDraft, type CritiqueInput } from './critique';

function input(overrides: Partial<CritiqueInput> = {}): CritiqueInput {
  return {
    platform: 'linkedin',
    objective: 'Conversion',
    hook: 'We cut onboarding time by 40% in 3 weeks.',
    cta: 'Book a 15-minute call to see your own numbers.',
    structure: 'PAS',
    fullText: 'We cut onboarding time by 40% in 3 weeks. Book a 15-minute call to see your own numbers.',
    ...overrides,
  };
}

describe('critiqueDraft', () => {
  it('returns a perfect score with no fixes for a clean, specific draft', () => {
    const result = critiqueDraft(input());
    expect(result.fixes).toEqual([]);
    expect(result.score).toBe(100);
  });

  it('flags a missing hook', () => {
    const result = critiqueDraft(input({ hook: '' }));
    expect(result.fixes.some((f) => f.category === 'hook')).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it('flags a hook that is too short to carry a claim', () => {
    const result = critiqueDraft(input({ hook: 'Hey!' }));
    expect(result.fixes.find((f) => f.category === 'hook')?.issue).toMatch(/too short/);
  });

  it('flags a draft with no concrete number or figure as a specificity issue', () => {
    const result = critiqueDraft(
      input({
        hook: 'Our customers love the new onboarding flow',
        cta: 'Book a call to see how it could help you.',
        fullText: 'Our customers love the new onboarding flow. Book a call to see how it could help you.',
      })
    );
    expect(result.fixes.some((f) => f.category === 'specificity')).toBe(true);
  });

  it('flags a missing CTA and tailors the suggestion to the objective', () => {
    const result = critiqueDraft(input({ cta: '', objective: 'Awareness' }));
    const fix = result.fixes.find((f) => f.category === 'cta');
    expect(fix).toBeDefined();
    expect(fix?.suggestion).toContain('Awareness');
  });

  it('flags an invalid structure as a platform_fit issue', () => {
    expect(critiqueDraft(input({ structure: 'listicle' })).fixes.some((f) => f.category === 'platform_fit')).toBe(true);
  });

  it('flags a MISSING structure on a platform that requires one (linkedin/instagram/tiktok/youtube/reddit)', () => {
    const result = critiqueDraft(input({ platform: 'reddit', structure: undefined }));
    expect(result.fixes.some((f) => f.category === 'platform_fit')).toBe(true);
  });

  it('does NOT flag a missing structure on a platform that never requires one (x/facebook/ugc_brief)', () => {
    const result = critiqueDraft(input({ platform: 'x', structure: undefined }));
    expect(result.fixes.some((f) => f.category === 'platform_fit')).toBe(false);
  });

  it('flags every AI-filler phrase found, reusing the shared banned-phrase list rather than a duplicate', () => {
    const result = critiqueDraft(
      input({
        fullText: 'This is a game-changer. Leverage the power of our platform to revolutionize your workflow in 3 steps.',
      })
    );
    const bannedFixes = result.fixes.filter((f) => f.category === 'banned_phrases');
    expect(bannedFixes.length).toBeGreaterThanOrEqual(3);
  });

  it('never returns a negative score no matter how many issues stack up', () => {
    const result = critiqueDraft({
      platform: 'x',
      objective: null,
      hook: '',
      cta: '',
      structure: 'listicle',
      fullText: 'game-changer revolutionize leverage synergy delve cutting-edge',
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
