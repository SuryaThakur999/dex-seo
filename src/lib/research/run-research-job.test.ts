import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResearchJob } from './run-research-job';
import { db } from '@/lib/db';
import { CompetitorSiteProvider } from './providers/competitor-site-provider';
import { GoogleNewsRssProvider } from './providers/google-news-rss-provider';
import { researchChannelCapabilities, recordResearchFailure } from './research-circuit-breaker';

vi.mock('@/lib/db', () => ({
  db: {
    researchJob: { findUnique: vi.fn(), update: vi.fn() },
    researchLogLine: { create: vi.fn() },
    clientProfile: { findUnique: vi.fn() },
    competitorEntity: { findMany: vi.fn(() => []) },
    evidenceItem: { createMany: vi.fn() },
    contentRecommendation: { create: vi.fn(() => ({ id: 'rec_1' })) },
  },
}));

vi.mock('./providers/competitor-site-provider', () => ({
  CompetitorSiteProvider: vi.fn().mockImplementation(() => ({ search: vi.fn(async () => []) })),
}));
vi.mock('./providers/google-news-rss-provider', () => ({
  GoogleNewsRssProvider: vi.fn().mockImplementation(() => ({ search: vi.fn(async () => []) })),
}));
vi.mock('./providers/trade-press-rss-provider', () => ({
  TradePressRssProvider: vi.fn().mockImplementation(() => ({ search: vi.fn(async () => []) })),
}));
vi.mock('./research-circuit-breaker', () => ({
  researchChannelCapabilities: vi.fn(async (channels: string[]) => channels.map((c) => ({ channel: c, available: true }))),
  recordResearchSuccess: vi.fn(),
  recordResearchFailure: vi.fn(),
}));

const baseJob = {
  id: 'job_1', customerId: 'cust_1', clientProfileId: 'profile_1', websiteId: 'site_1',
  cancelRequested: false, tokenCost: 0,
};
const baseProfile = {
  id: 'profile_1', businessDescription: 'A bakery', audience: 'Families', markets: ['DE'], languages: ['de'],
  websites: [{ url: 'https://bakery.test' }],
};

describe('runResearchJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.researchJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(baseJob);
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(baseProfile);
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'comp_1', name: 'Rival Bakery', canonicalDomain: 'rival.test' },
    ]);
  });

  it('reaches completed status when every connector succeeds', async () => {
    await runResearchJob('job_1');
    const finalUpdate = (db.researchJob.update as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(finalUpdate.data.status).toBe('completed');
    expect(finalUpdate.data.completedAt).toBeInstanceOf(Date);
  });

  it('continues past one failed connector and reaches completed with a partial status plus a log trail', async () => {
    (CompetitorSiteProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      search: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
    }));

    await runResearchJob('job_1');

    expect(recordResearchFailure).toHaveBeenCalledWith('competitor_site');
    expect(db.researchLogLine.create).toHaveBeenCalled();
    const finalUpdate = (db.researchJob.update as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(finalUpdate.data.status).toBe('partial');
  });

  it('skips a channel the circuit breaker reports unavailable, without calling its connector', async () => {
    (researchChannelCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue([
      { channel: 'competitor_site', available: false, unavailableReason: 'Circuit breaker open' },
      { channel: 'google_news_rss', available: true },
      { channel: 'trade_press_rss', available: true },
    ]);
    const competitorSearch = vi.fn(async () => []);
    (CompetitorSiteProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({ search: competitorSearch }));

    await runResearchJob('job_1');

    expect(competitorSearch).not.toHaveBeenCalled();
  });

  it('stops cleanly mid-stage and marks the job cancelled when cancelRequested flips', async () => {
    (db.researchJob.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseJob)
      .mockResolvedValue({ ...baseJob, cancelRequested: true });

    await runResearchJob('job_1');

    const finalUpdate = (db.researchJob.update as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(finalUpdate.data.status).toBe('cancelled');
  });

  it('marks the job failed instead of leaving it stuck at running when something outside a connector throws', async () => {
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection reset'));

    await runResearchJob('job_1');

    const finalUpdate = (db.researchJob.update as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(finalUpdate.data.status).toBe('failed');
    expect(finalUpdate.data.error).toContain('connection reset');
    expect(finalUpdate.data.completedAt).toBeInstanceOf(Date);
  });
});
