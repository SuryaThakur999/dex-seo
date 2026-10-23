import { describe, it, expect } from 'vitest';
import { formatSuggestionCopy } from './preference-suggestion-card';

describe('formatSuggestionCopy', () => {
  it('includes the phrase and the real supporting-edit count', () => {
    const copy = formatSuggestionCopy('industry-leading', 4);

    expect(copy).toContain('industry-leading');
    expect(copy).toContain('4 drafts');
    expect(copy).toContain('Dex noticed a pattern');
  });

  it('uses singular "draft" for a count of 1', () => {
    const copy = formatSuggestionCopy('industry-leading', 1);

    expect(copy).toContain('1 draft');
    expect(copy).not.toContain('1 drafts');
  });
});
