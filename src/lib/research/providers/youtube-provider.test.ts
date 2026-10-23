import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./agent-reach-client', async () => {
  const actual = await vi.importActual<typeof import('./agent-reach-client')>('./agent-reach-client');
  return { ...actual, callAgentReach: vi.fn() };
});
import { callAgentReach } from './agent-reach-client';
import { YouTubeProvider } from './youtube-provider';

describe('YouTubeProvider', () => {
  beforeEach(() => {
    process.env.AGENT_REACH_INTERNAL_SECRET = 'test-secret';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_REACH_INTERNAL_SECRET;
  });

  it('maps a video\'s title, description and captions to a ResearchResult tagged youtube', async () => {
    (callAgentReach as ReturnType<typeof vi.fn>).mockResolvedValue({
      canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
      title: 'Competitor product launch',
      publishedAt: new Date('2026-09-20T00:00:00.000Z'),
      excerpt: 'Launch description plus captions text.',
      sourceType: 'other',
      agentReachVersion: '1.5.0',
    });
    const provider = new YouTubeProvider();
    const results = await provider.search({ query: 'ignored', windowDays: 30, domain: 'https://www.youtube.com/watch?v=abc123' });
    expect(results).toHaveLength(1);
    expect(results[0].platform).toBe('youtube');
    expect(results[0].sourceType).toBe('other');
    expect(callAgentReach).toHaveBeenCalledWith({ channel: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' });
  });
});
