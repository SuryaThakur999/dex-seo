import { safeFetch } from '@/lib/safe-fetch';
import { AgentReachProvider } from './agent-reach-provider';
import type { ResearchProvider, ResearchCapability, ProviderHealth, ResearchQuery, ResearchResult, ResearchDocumentRequest, ResearchDocument } from '../research-provider';

// Query/domain-scoping logic for a single competitor's site. The actual fetch+extraction is
// delegated to AgentReachProvider (Task 3b, production Agent Reach) -- this connector's own job
// is pre-validating the domain against safeFetch's allowlist/SSRF check first, in Node, before
// the URL is handed to the internal Agent Reach function.
export class CompetitorSiteProvider implements ResearchProvider {
  name = 'competitor_site' as const;
  private readonly agentReach = new AgentReachProvider('web', 'competitor_site');

  async capabilities(): Promise<ResearchCapability[]> {
    return [{ channel: 'competitor_site', available: true }];
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await safeFetch('https://www.google.com', { timeoutMs: 5000 });
      return { healthy: res.ok, checkedAt: new Date() };
    } catch (err) {
      return { healthy: false, checkedAt: new Date(), detail: err instanceof Error ? err.message : 'unknown error' };
    }
  }

  async search(input: ResearchQuery): Promise<ResearchResult[]> {
    if (!input.domain) return [];
    try {
      await safeFetch(input.domain);
    } catch {
      return []; // domain failed the allowlist/SSRF pre-check -- never reaches Agent Reach
    }
    return this.agentReach.search(input);
  }

  async read(input: ResearchDocumentRequest): Promise<ResearchDocument> {
    await safeFetch(input.url);
    return this.agentReach.read(input);
  }
}
