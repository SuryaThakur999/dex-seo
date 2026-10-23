import { checkBreaker, recordSuccess, recordFailure } from '@/lib/circuit-breaker';
import type { ResearchCapability, ResearchPlatform } from './research-provider';

// Thin wrapper reusing the existing shared ProviderCircuitBreaker table (Phase 1C), keyed
// provider: 'research', model: <ResearchPlatform> -- same read/open/cooldown-double logic
// already shipped for GenerationJob, imported and reused, not reimplemented.
const RESEARCH_PROVIDER = 'research';

export async function researchChannelCapabilities(channels: ResearchPlatform[]): Promise<ResearchCapability[]> {
  const results: ResearchCapability[] = [];
  for (const channel of channels) {
    const breaker = await checkBreaker(RESEARCH_PROVIDER, channel);
    results.push(breaker.blocked
      ? { channel, available: false, unavailableReason: `Circuit breaker open until ${breaker.retryAt?.toISOString() ?? 'unknown'}` }
      : { channel, available: true });
  }
  return results;
}

export async function recordResearchSuccess(channel: ResearchPlatform): Promise<void> {
  await recordSuccess(RESEARCH_PROVIDER, channel);
}

export async function recordResearchFailure(channel: ResearchPlatform): Promise<void> {
  await recordFailure(RESEARCH_PROVIDER, channel);
}
