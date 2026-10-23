import { describe, it, expect } from 'vitest';
import { flagPages, type PageSnapshot } from './growth-brain';

function page(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    url: 'https://example.com/page',
    title: 'A Page',
    metaDescription: 'A perfectly fine meta description that sits comfortably within range.',
    h1: 'A Page',
    impressions: 10,
    clicks: 1,
    ctr: 0.1,
    ...overrides,
  };
}

describe('flagPages', () => {
  it('flags a page with no meta description', () => {
    const result = flagPages([page({ metaDescription: null })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('Missing meta description');
  });

  it('flags a page with a too-short meta description', () => {
    const result = flagPages([page({ metaDescription: 'Too short.' })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('too short');
  });

  it('flags a page with a too-long meta description', () => {
    const result = flagPages([page({ metaDescription: 'x'.repeat(200) })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('too long');
  });

  it('flags a page with high impressions and low CTR even if the meta description is well-formed', () => {
    const result = flagPages([page({ impressions: 500, ctr: 0.005 })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('low click-through rate');
  });

  it('does not flag a well-formed page with normal CTR', () => {
    const result = flagPages([page({})]);
    expect(result).toHaveLength(0);
  });

  it('does not flag a well-formed page with high impressions but healthy CTR', () => {
    const result = flagPages([page({ impressions: 500, ctr: 0.05 })]);
    expect(result).toHaveLength(0);
  });

  it('processes multiple pages independently', () => {
    const result = flagPages([page({ metaDescription: null, url: 'https://example.com/a' }), page({ url: 'https://example.com/b' })]);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/a');
  });
});
