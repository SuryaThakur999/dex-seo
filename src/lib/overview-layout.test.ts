import { describe, expect, it } from 'vitest';
import { OVERVIEW_BLOCKS } from './overview-layout';

describe('OVERVIEW_BLOCKS', () => {
  it('has at most 5 blocks', () => {
    expect(OVERVIEW_BLOCKS.length).toBeLessThanOrEqual(5);
  });

  it('is exactly today, fixes-for-your-site, competitors-and-ideas, ask-dex in that order', () => {
    expect(OVERVIEW_BLOCKS).toEqual(['today', 'fixes-for-your-site', 'competitors-and-ideas', 'ask-dex']);
  });

  it('has no duplicate block ids', () => {
    expect(new Set(OVERVIEW_BLOCKS).size).toBe(OVERVIEW_BLOCKS.length);
  });
});
