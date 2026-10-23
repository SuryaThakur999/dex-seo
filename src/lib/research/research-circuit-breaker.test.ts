import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/circuit-breaker', () => ({
  checkBreaker: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
import { checkBreaker, recordSuccess, recordFailure } from '@/lib/circuit-breaker';
import { researchChannelCapabilities, recordResearchSuccess, recordResearchFailure } from './research-circuit-breaker';

describe('researchChannelCapabilities', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports an open channel as unavailable while a different channel stays available', async () => {
    (checkBreaker as ReturnType<typeof vi.fn>).mockImplementation(async (_provider: string, model: string) => {
      if (model === 'google_news_rss') return { blocked: true, retryAt: new Date('2026-10-14T01:00:00Z') };
      return { blocked: false };
    });

    const capabilities = await researchChannelCapabilities(['competitor_site', 'google_news_rss']);

    const news = capabilities.find((c) => c.channel === 'google_news_rss');
    const competitor = capabilities.find((c) => c.channel === 'competitor_site');
    expect(news?.available).toBe(false);
    expect(news?.unavailableReason).toContain('Circuit breaker');
    expect(competitor?.available).toBe(true);
    expect(checkBreaker).toHaveBeenCalledWith('research', 'google_news_rss');
  });
});

describe('recordResearchSuccess / recordResearchFailure', () => {
  it('key the shared breaker on provider "research" and the platform as model', async () => {
    await recordResearchSuccess('competitor_site');
    expect(recordSuccess).toHaveBeenCalledWith('research', 'competitor_site');
    await recordResearchFailure('competitor_site');
    expect(recordFailure).toHaveBeenCalledWith('research', 'competitor_site');
  });
});
