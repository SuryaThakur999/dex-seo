import { describe, expect, it } from 'vitest';
import { normalizeEvidence, labelConfidence } from './evidence-normalizer';
import type { ResearchResult } from './research-provider';

const now = new Date('2026-10-14T00:00:00Z');
function result(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalUrl: 'https://a.test/1', title: 'T', publishedAt: new Date('2026-10-10'),
    excerpt: 'E', sourceType: 'news', platform: 'google_news_rss', ...overrides,
  };
}

describe('normalizeEvidence', () => {
  it('drops content older than the window, keeps undated content flagged low-confidence instead of dropping it', () => {
    const items = normalizeEvidence([
      result({ canonicalUrl: 'https://a.test/old', publishedAt: new Date('2026-01-01') }),
      result({ canonicalUrl: 'https://a.test/undated', publishedAt: null }),
      result({ canonicalUrl: 'https://a.test/fresh', publishedAt: new Date('2026-10-12') }),
    ], 30, now);
    expect(items.map((i) => i.canonicalUrl)).toEqual(['https://a.test/undated', 'https://a.test/fresh']);
    expect(items.find((i) => i.canonicalUrl === 'https://a.test/undated')?.extractionConfidence).toBeLessThan(0.5);
  });

  it('deduplicates by canonical URL, keeping the earliest-retrieved copy (syndication fixture)', () => {
    const items = normalizeEvidence([
      result({ canonicalUrl: 'https://syndicate.test/a', title: 'Original' }),
      result({ canonicalUrl: 'https://syndicate.test/a', title: 'Reposted copy' }),
    ], 30, now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Original');
  });
});

describe('labelConfidence', () => {
  it('labels insufficient_evidence for zero or one weak item', () => {
    expect(labelConfidence([])).toBe('insufficient_evidence');
  });

  it('labels repeated_discussion for 2+ independent sources without a primary source', () => {
    const items = normalizeEvidence([
      result({ canonicalUrl: 'https://a.test/1' }),
      result({ canonicalUrl: 'https://b.test/1' }),
    ], 30, now);
    expect(labelConfidence(items)).toBe('repeated_discussion');
  });

  it('labels verified_market_development only with a primary source (competitor_site/own_site) present', () => {
    const items = normalizeEvidence([
      result({ canonicalUrl: 'https://competitor.test/pricing', platform: 'competitor_site' }),
      result({ canonicalUrl: 'https://news.test/1' }),
    ], 30, now);
    expect(labelConfidence(items)).toBe('verified_market_development');
  });
});
