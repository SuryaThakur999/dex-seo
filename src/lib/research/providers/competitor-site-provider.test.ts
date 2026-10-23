import { describe, expect, it, vi } from 'vitest';
import { CompetitorSiteProvider } from './competitor-site-provider';

vi.mock('@/lib/safe-fetch', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from '@/lib/safe-fetch';

vi.mock('./agent-reach-provider', () => ({
  AgentReachProvider: vi.fn().mockImplementation(() => ({
    search: vi.fn(),
    healthCheck: vi.fn(),
  })),
}));
import { AgentReachProvider } from './agent-reach-provider';

describe('CompetitorSiteProvider', () => {
  it('pre-validates the domain with safeFetch before delegating the actual read to AgentReachProvider', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const mockSearch = vi.fn().mockResolvedValue([{
      canonicalUrl: 'https://competitor.test', title: 'New pricing', publishedAt: new Date('2026-10-05T00:00:00Z'),
      excerpt: 'We cut prices 10%.', sourceType: 'other', platform: 'competitor_site',
    }]);
    (AgentReachProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ search: mockSearch, healthCheck: vi.fn() }));

    const provider = new CompetitorSiteProvider();
    const results = await provider.search({ query: 'pricing', windowDays: 30, domain: 'https://competitor.test' });

    expect(safeFetch).toHaveBeenCalledWith('https://competitor.test');
    expect(mockSearch).toHaveBeenCalledWith({ query: 'pricing', windowDays: 30, domain: 'https://competitor.test' });
    expect(results[0].platform).toBe('competitor_site');
  });

  it('returns no results when the domain fails safeFetch pre-validation, without calling AgentReachProvider', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    const mockSearch = vi.fn();
    (AgentReachProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ search: mockSearch, healthCheck: vi.fn() }));

    const provider = new CompetitorSiteProvider();
    const results = await provider.search({ query: 'any', windowDays: 30, domain: 'https://unreachable.test' });

    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('reports unhealthy rather than throwing when the domain is unreachable', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new CompetitorSiteProvider();
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(false);
  });
});
