import { describe, expect, it } from 'vitest';
import { buildRevisionPrompt } from './revise';
import { GROUNDING_RULES } from './adapter-types';
import type { CritiqueResult } from './critique';

const critiqueWithFixes: CritiqueResult = {
  score: 60,
  fixes: [
    { category: 'hook', issue: 'Hook is missing.', suggestion: 'Write a hook that states the specific result.' },
    { category: 'banned_phrases', issue: 'Contains "game-changer".', suggestion: 'Remove it and be concrete.' },
  ],
};

describe('buildRevisionPrompt', () => {
  it('includes GROUNDING_RULES verbatim so the revision pass stays under the same no-hallucination discipline', () => {
    const prompt = buildRevisionPrompt({ fullText: 'Our platform is a game-changer.', critique: critiqueWithFixes });
    expect(prompt).toContain(GROUNDING_RULES);
  });

  it('lists every fix with its category, issue, and suggestion', () => {
    const prompt = buildRevisionPrompt({ fullText: 'Our platform is a game-changer.', critique: critiqueWithFixes });
    expect(prompt).toContain('[hook]');
    expect(prompt).toContain('Hook is missing.');
    expect(prompt).toContain('[banned_phrases]');
    expect(prompt).toContain('Remove it and be concrete.');
  });

  it('includes the original draft text unchanged', () => {
    const prompt = buildRevisionPrompt({ fullText: 'Our platform is a game-changer.', critique: critiqueWithFixes });
    expect(prompt).toContain('Our platform is a game-changer.');
  });

  it('never calls a provider -- it only returns a string', () => {
    const result = buildRevisionPrompt({ fullText: 'text', critique: critiqueWithFixes });
    expect(typeof result).toBe('string');
  });

  it('throws rather than building a no-op revision prompt when the critique found nothing to fix', () => {
    expect(() => buildRevisionPrompt({ fullText: 'text', critique: { score: 100, fixes: [] } })).toThrow(/no fixes/);
  });
});
