import { describe, it, expect } from 'vitest';
import { isPreferenceActive, withoutPreference } from './preference-activation';

describe('isPreferenceActive', () => {
  it('is true when the phrase is present', () => {
    expect(isPreferenceActive(['industry-leading', 'best-in-class'], 'industry-leading')).toBe(true);
  });

  it('is false when the phrase is absent', () => {
    expect(isPreferenceActive(['best-in-class'], 'industry-leading')).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(isPreferenceActive([], 'industry-leading')).toBe(false);
  });
});

describe('withoutPreference', () => {
  it('removes the exact matching phrase', () => {
    expect(withoutPreference(['industry-leading', 'best-in-class'], 'industry-leading')).toEqual(['best-in-class']);
  });

  it('removes every occurrence when the phrase is duplicated', () => {
    expect(withoutPreference(['industry-leading', 'best-in-class', 'industry-leading'], 'industry-leading')).toEqual([
      'best-in-class',
    ]);
  });

  it('is a no-op when the phrase is not present', () => {
    expect(withoutPreference(['best-in-class'], 'industry-leading')).toEqual(['best-in-class']);
  });

  it('does not mutate the input array', () => {
    const input = ['industry-leading'];
    withoutPreference(input, 'industry-leading');
    expect(input).toEqual(['industry-leading']);
  });
});
