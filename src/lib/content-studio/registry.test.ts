import { describe, it, expect } from 'vitest';
import { getAdapter, listAdapters, ALL_PLATFORMS } from './registry';

describe('content studio registry', () => {
  it('resolves each of the 8 platforms to an adapter with a matching platform field', () => {
    const platforms = ['linkedin', 'instagram', 'facebook', 'x', 'reddit', 'tiktok', 'youtube', 'ugc_brief'] as const;
    for (const platform of platforms) {
      expect(getAdapter(platform).platform).toBe(platform);
    }
  });

  it('lists all 8 adapters', () => {
    expect(listAdapters()).toHaveLength(8);
  });

  it('exposes ALL_PLATFORMS as the one runtime platform list, matching the adapters', () => {
    expect([...ALL_PLATFORMS].sort()).toEqual(
      ['facebook', 'instagram', 'linkedin', 'reddit', 'tiktok', 'ugc_brief', 'x', 'youtube']
    );
    expect([...ALL_PLATFORMS].sort()).toEqual(listAdapters().map((a) => a.platform).sort());
  });
});
