import { describe, expect, it, vi } from 'vitest';
import { TradePressRssProvider } from './trade-press-rss-provider';

vi.mock('@/lib/safe-fetch', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from '@/lib/safe-fetch';

const FEED = `<?xml version="1.0"?><rss><channel>
  <item><title>Trade coverage</title><link>https://trade.test/a</link>
    <pubDate>Wed, 01 Oct 2026 00:00:00 GMT</pubDate><description>Trade text.</description></item>
</channel></rss>`;

describe('TradePressRssProvider', () => {
  it('reads every configured feed and tags results trade_press_rss', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, text: async () => FEED });
    const provider = new TradePressRssProvider(['https://trade.test/rss', 'https://trade2.test/rss']);
    const results = await provider.search({ query: 'ignored for user feeds', windowDays: 30 });
    expect(safeFetch).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.platform === 'trade_press_rss')).toBe(true);
  });

  it('continues past one unreachable feed instead of failing the whole search', async () => {
    (safeFetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => FEED });
    const provider = new TradePressRssProvider(['https://down.test/rss', 'https://trade.test/rss']);
    const results = await provider.search({ query: 'x', windowDays: 30 });
    expect(results).toHaveLength(1);
  });
});
