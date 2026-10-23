import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agent-reach-client', async () => {
  const actual = await vi.importActual<typeof import('./agent-reach-client')>('./agent-reach-client');
  return { ...actual, callAgentReach: vi.fn() };
});
import { callAgentReach, AgentReachTimeoutError } from './agent-reach-client';
import { AgentReachProvider } from './agent-reach-provider';

describe('AgentReachProvider', () => {
  beforeEach(() => {
    process.env.AGENT_REACH_INTERNAL_SECRET = 'test-secret';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_REACH_INTERNAL_SECRET;
  });

  it('reads a web page and maps it to a ResearchResult tagged with the given platform', async () => {
    (callAgentReach as ReturnType<typeof vi.fn>).mockResolvedValue({
      canonicalUrl: 'https://competitor.test/pricing', title: 'New pricing',
      publishedAt: new Date('2026-10-05T00:00:00.000Z'), excerpt: 'We cut prices 10%.',
      sourceType: 'pricing_page', agentReachVersion: '1.5.0',
    });
    const provider = new AgentReachProvider('web', 'competitor_site');
    const doc = await provider.read({ url: 'https://competitor.test/pricing' });
    expect(doc.canonicalUrl).toBe('https://competitor.test/pricing');
    expect(callAgentReach).toHaveBeenCalledWith({ channel: 'web', url: 'https://competitor.test/pricing' });
  });

  it('read() surfaces publishedAt and hasCaptions through to the caller when the channel provides them', async () => {
    (callAgentReach as ReturnType<typeof vi.fn>).mockResolvedValue({
      canonicalUrl: 'https://youtube.test/watch?v=abc', title: 'A video',
      publishedAt: new Date('2026-10-01T00:00:00.000Z'), excerpt: 'Caption text.',
      sourceType: 'other', agentReachVersion: '1.5.0', hasCaptions: true,
    });
    const provider = new AgentReachProvider('youtube', 'youtube');
    const doc = await provider.read({ url: 'https://youtube.test/watch?v=abc' });
    expect(doc.publishedAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(doc.hasCaptions).toBe(true);
  });

  it('search() reads the single URL given as the query domain and tags the result platform', async () => {
    (callAgentReach as ReturnType<typeof vi.fn>).mockResolvedValue({
      canonicalUrl: 'https://competitor.test/', title: 'Home', publishedAt: null,
      excerpt: 'No date here.', sourceType: 'other', agentReachVersion: '1.5.0',
    });
    const provider = new AgentReachProvider('web', 'competitor_site');
    const results = await provider.search({ query: 'ignored', windowDays: 30, domain: 'https://competitor.test/' });
    expect(results).toHaveLength(1);
    expect(results[0].platform).toBe('competitor_site');
    expect(results[0].publishedAt).toBeNull();
  });

  it('treats a client timeout as unhealthy, not an unhandled rejection, via healthCheck', async () => {
    (callAgentReach as ReturnType<typeof vi.fn>).mockRejectedValue(new AgentReachTimeoutError());
    const provider = new AgentReachProvider('web', 'competitor_site');
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(false);
  });

  it('returns an empty array from search() rather than throwing when the channel times out', async () => {
    (callAgentReach as ReturnType<typeof vi.fn>).mockRejectedValue(new AgentReachTimeoutError());
    const provider = new AgentReachProvider('web', 'competitor_site');
    const results = await provider.search({ query: 'x', windowDays: 30, domain: 'https://down.test/' });
    expect(results).toEqual([]);
  });
});
