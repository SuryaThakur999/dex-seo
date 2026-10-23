import { describe, expect, it, vi } from 'vitest';
import { GoogleNewsRssProvider } from './google-news-rss-provider';

vi.mock('@/lib/safe-fetch', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from '@/lib/safe-fetch';

const FEED = `<?xml version="1.0"?><rss><channel>
  <item><title>Industry coverage</title><link>https://news.test/a</link>
    <pubDate>Wed, 01 Oct 2026 00:00:00 GMT</pubDate><description>Coverage text.</description></item>
</channel></rss>`;

describe('GoogleNewsRssProvider', () => {
  it('builds a DACH-scoped query URL (hl=de) and maps items to ResearchResult', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, text: async () => FEED });
    const provider = new GoogleNewsRssProvider();
    const results = await provider.search({ query: 'Baeckerei Berlin', windowDays: 30 });
    const calledUrl = (safeFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('news.google.com/rss/search');
    expect(calledUrl).toContain('hl=de');
    expect(results[0].platform).toBe('google_news_rss');
    expect(results[0].canonicalUrl).toBe('https://news.test/a');
  });

  it('drops items older than the requested window', async () => {
    const old = FEED.replace('01 Oct 2026', '01 Jan 2020');
    (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, text: async () => old });
    const provider = new GoogleNewsRssProvider();
    const results = await provider.search({ query: 'x', windowDays: 30 });
    expect(results).toHaveLength(0);
  });
});
