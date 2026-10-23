import { safeFetch } from '@/lib/safe-fetch';
import { parseRssItems } from './rss-parse';
import type { ResearchProvider, ResearchCapability, ProviderHealth, ResearchQuery, ResearchResult, ResearchDocumentRequest, ResearchDocument } from '../research-provider';

// Google News RSS stays on direct safeFetch+cheerio, not AgentReachProvider: plain RSS/Atom XML
// is not anti-bot-protected or JS-rendered, so Agent Reach has no actual value-add here (its own
// rss channel is "feedparser directly," the same primitive this file already uses via cheerio's
// XML mode) -- routing it through the extra internal-function hop would be pure overhead.
const REGIONS = [{ gl: 'DE', ceid: 'DE:de' }, { gl: 'AT', ceid: 'AT:de' }, { gl: 'CH', ceid: 'CH:de' }];

export class GoogleNewsRssProvider implements ResearchProvider {
  name = 'google_news_rss' as const;

  async capabilities(): Promise<ResearchCapability[]> {
    return [{ channel: 'google_news_rss', available: true }];
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await safeFetch('https://news.google.com/rss', { timeoutMs: 5000 });
      return { healthy: res.ok, checkedAt: new Date() };
    } catch (err) {
      return { healthy: false, checkedAt: new Date(), detail: err instanceof Error ? err.message : 'unknown error' };
    }
  }

  async search(input: ResearchQuery): Promise<ResearchResult[]> {
    const cutoff = Date.now() - input.windowDays * 24 * 60 * 60 * 1000;
    const results: ResearchResult[] = [];
    for (const region of REGIONS) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(input.query)}&hl=de&gl=${region.gl}&ceid=${region.ceid}`;
      const res = await safeFetch(url);
      if (!res.ok) continue;
      const items = parseRssItems(await res.text());
      for (const item of items) {
        if (item.publishedAt && item.publishedAt.getTime() < cutoff) continue;
        results.push({
          canonicalUrl: item.link, title: item.title || null, publishedAt: item.publishedAt,
          excerpt: item.description.slice(0, 500), sourceType: 'news', platform: 'google_news_rss',
        });
      }
    }
    return results;
  }

  async read(input: ResearchDocumentRequest): Promise<ResearchDocument> {
    const res = await safeFetch(input.url);
    return { canonicalUrl: input.url, text: await res.text(), retrievedAt: new Date() };
  }
}
