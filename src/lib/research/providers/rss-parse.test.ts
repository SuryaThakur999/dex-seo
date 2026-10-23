import { describe, expect, it } from 'vitest';
import { parseRssItems } from './rss-parse';

const FEED = `<?xml version="1.0"?><rss><channel>
  <item><title>Competitor launches new line</title><link>https://news.test/a</link>
    <pubDate>Wed, 01 Oct 2026 00:00:00 GMT</pubDate><description>Short summary.</description></item>
  <item><title>Undated wire item</title><link>https://news.test/b</link><description>No date given.</description></item>
</channel></rss>`;

describe('parseRssItems', () => {
  it('parses dated and undated items without inventing a date', () => {
    const items = parseRssItems(FEED);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Competitor launches new line', link: 'https://news.test/a' });
    expect(items[0].publishedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(items[1].publishedAt).toBeNull();
  });
});
