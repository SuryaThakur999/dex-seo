import { safeFetch } from '@/lib/safe-fetch';
import { parseRssItems } from './rss-parse';
import type { ResearchProvider, ResearchCapability, ProviderHealth, ResearchQuery, ResearchResult, ResearchDocumentRequest, ResearchDocument } from '../research-provider';

// Same rationale as GoogleNewsRssProvider: plain RSS stays on direct safeFetch+cheerio, not
// AgentReachProvider (no anti-bot/JS-rendering concern, no real Agent Reach value-add).
export class TradePressRssProvider implements ResearchProvider {
  name = 'trade_press_rss' as const;
  constructor(private readonly feedUrls: string[]) {}

  async capabilities(): Promise<ResearchCapability[]> {
    return [{ channel: 'trade_press_rss', available: this.feedUrls.length > 0 }];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { healthy: this.feedUrls.length > 0, checkedAt: new Date() };
  }

  async search(input: ResearchQuery): Promise<ResearchResult[]> {
    const cutoff = Date.now() - input.windowDays * 24 * 60 * 60 * 1000;
    const results: ResearchResult[] = [];
    for (const feedUrl of this.feedUrls) {
      try {
        const res = await safeFetch(feedUrl);
        if (!res.ok) continue;
        for (const item of parseRssItems(await res.text())) {
          if (item.publishedAt && item.publishedAt.getTime() < cutoff) continue;
          results.push({
            canonicalUrl: item.link, title: item.title || null, publishedAt: item.publishedAt,
            excerpt: item.description.slice(0, 500), sourceType: 'news', platform: 'trade_press_rss',
          });
        }
      } catch {
        continue; // one dead feed never fails the whole search -- same discipline as the circuit breaker's per-channel isolation
      }
    }
    return results;
  }

  async read(input: ResearchDocumentRequest): Promise<ResearchDocument> {
    const res = await safeFetch(input.url);
    return { canonicalUrl: input.url, text: await res.text(), retrievedAt: new Date() };
  }
}
