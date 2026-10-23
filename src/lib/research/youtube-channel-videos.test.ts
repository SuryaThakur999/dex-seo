import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/safe-fetch', () => ({ safeFetch: vi.fn(), UnsafeUrlError: class UnsafeUrlError extends Error {} }));
vi.mock('./providers/agent-reach-client', () => ({ callAgentReachVideoList: vi.fn() }));

import { safeFetch } from '@/lib/safe-fetch';
import { callAgentReachVideoList } from './providers/agent-reach-client';
import { listRecentVideos } from './youtube-channel-videos';

describe('listRecentVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('pre-checks the channel URL against safeFetch before calling Agent Reach', async () => {
    (callAgentReachVideoList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listRecentVideos('https://www.youtube.com/@channel/videos');
    expect(safeFetch).toHaveBeenCalledWith('https://www.youtube.com/@channel/videos');
  });

  it('rejects before any Agent Reach call when the channel URL fails the allowlist/SSRF check', async () => {
    (safeFetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('blocked'));
    await expect(listRecentVideos('http://169.254.169.254/videos')).rejects.toThrow('blocked');
    expect(callAgentReachVideoList).not.toHaveBeenCalled();
  });

  it('maps the Agent Reach list response to the documented shape', async () => {
    (callAgentReachVideoList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'vid1', title: 'Video one', publishedAt: new Date('2026-10-01T00:00:00.000Z') },
      { id: 'vid2', title: 'Video two', publishedAt: null },
    ]);
    const videos = await listRecentVideos('https://www.youtube.com/@channel/videos');
    expect(videos).toEqual([
      { id: 'vid1', title: 'Video one', publishedAt: new Date('2026-10-01T00:00:00.000Z') },
      { id: 'vid2', title: 'Video two', publishedAt: null },
    ]);
  });
});
