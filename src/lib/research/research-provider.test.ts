import { describe, expect, it } from 'vitest';
import type { ResearchProvider, ResearchResult } from './research-provider';

describe('ResearchProvider contract', () => {
  it('a conforming provider implements all four methods and returns dated, sourced results', async () => {
    const fake: ResearchProvider = {
      name: 'fake',
      async capabilities() { return [{ channel: 'competitor_site', available: true }]; },
      async healthCheck() { return { healthy: true, checkedAt: new Date() }; },
      async search() {
        const result: ResearchResult = {
          canonicalUrl: 'https://competitor.test/blog/post', title: 'A post', publishedAt: new Date('2026-10-01'),
          excerpt: 'Real excerpt text.', sourceType: 'blog', platform: 'competitor_site',
        };
        return [result];
      },
      async read(input) { return { canonicalUrl: input.url, text: 'Full text', retrievedAt: new Date() }; },
    };
    const results = await fake.search({ query: 'anything', windowDays: 30 });
    expect(results[0].canonicalUrl).toBe('https://competitor.test/blog/post');
    expect(results[0].publishedAt).toBeInstanceOf(Date);
  });
});
