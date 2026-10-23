import { callAgentReach, type AgentReachChannel } from './agent-reach-client';
import type {
  ResearchProvider, ResearchCapability, ProviderHealth, ResearchQuery, ResearchResult,
  ResearchDocumentRequest, ResearchDocument, ResearchPlatform,
} from '../research-provider';

// Wraps the Agent Reach Python function (Task 3b) behind the ResearchProvider contract. One
// instance per (channel, platform) pair -- e.g. ('web', 'competitor_site') or ('rss', 'google_news_rss')
// -- so connector tasks (3, 4, 5, 5b) keep their own query/domain/feed-list logic and delegate only
// the actual fetch+extraction here.
export class AgentReachProvider implements ResearchProvider {
  readonly name: ResearchPlatform;

  constructor(private readonly channel: AgentReachChannel, platform: ResearchPlatform) {
    this.name = platform;
  }

  async capabilities(): Promise<ResearchCapability[]> {
    return [{ channel: this.name, available: true }];
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      await callAgentReach({ channel: this.channel, url: 'https://www.google.com' }, { timeoutMs: 5000 });
      return { healthy: true, checkedAt: new Date() };
    } catch (err) {
      return { healthy: false, checkedAt: new Date(), detail: err instanceof Error ? err.message : 'unknown error' };
    }
  }

  async search(input: ResearchQuery): Promise<ResearchResult[]> {
    if (!input.domain) return [];
    try {
      const result = await callAgentReach({ channel: this.channel, url: input.domain });
      return [{
        canonicalUrl: result.canonicalUrl,
        title: result.title,
        publishedAt: result.publishedAt,
        excerpt: result.excerpt,
        sourceType: result.sourceType,
        platform: this.name,
      }];
    } catch {
      // A failed channel never fails the whole search -- the caller's circuit breaker
      // records the failure; this provider just reports no results for this round.
      return [];
    }
  }

  async read(input: ResearchDocumentRequest): Promise<ResearchDocument> {
    const result = await callAgentReach({ channel: this.channel, url: input.url });
    return {
      canonicalUrl: result.canonicalUrl,
      text: result.excerpt,
      retrievedAt: new Date(),
      publishedAt: result.publishedAt,
      hasCaptions: result.hasCaptions,
    };
  }
}
