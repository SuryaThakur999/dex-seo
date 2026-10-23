import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCompetitorWatch } from './competitor-watch-job';
import { db } from '@/lib/db';
import { recordResearchFailure } from './research-circuit-breaker';

const readMock = vi.fn();
vi.mock('./providers/competitor-site-provider', () => ({
  CompetitorSiteProvider: vi.fn().mockImplementation(() => ({ read: readMock })),
}));
vi.mock('./research-circuit-breaker', () => ({
  researchChannelCapabilities: vi.fn(async (channels: string[]) => channels.map((c) => ({ channel: c, available: true }))),
  recordResearchSuccess: vi.fn(),
  recordResearchFailure: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findUnique: vi.fn() },
    competitorEntity: { findMany: vi.fn() },
    researchJob: { create: vi.fn(), update: vi.fn() },
    researchLogLine: { create: vi.fn() },
    evidenceItem: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

const PROFILE = { customerId: 'cust_1' };
const JOB = { id: 'job_1' };

function competitor(overrides: Partial<{ id: string; name: string; canonicalDomain: string | null; createdAt: Date }> = {}) {
  return { id: 'comp_1', name: 'Acme Co', canonicalDomain: 'acme.test', createdAt: new Date('2026-01-01'), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(PROFILE);
  (db.researchJob.create as ReturnType<typeof vi.fn>).mockResolvedValue(JOB);
  (db.researchJob.update as ReturnType<typeof vi.fn>).mockResolvedValue(JOB);
  (db.evidenceItem.create as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'evidence_new', retrievedAt: new Date('2026-10-14'), ...data }));
});

describe('runCompetitorWatch', () => {
  it('(a) a page whose content hash changed produces a new EvidenceItem carrying both the prior and current read, reported as changed', async () => {
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([competitor()]);
    readMock.mockResolvedValue({ canonicalUrl: 'https://acme.test', text: 'New homepage copy', retrievedAt: new Date('2026-10-14') });
    (db.evidenceItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'evidence_prior', retrievedAt: new Date('2026-10-07'),
      observedMetrics: { contentHash: 'old-hash-that-will-never-match' },
    }).mockResolvedValue(null);

    const result = await runCompetitorWatch('profile_1');

    expect(result.changed).toHaveLength(1);
    expect(db.evidenceItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entityId: 'comp_1', platform: 'competitor_site', canonicalUrl: 'https://acme.test',
        observedMetrics: expect.objectContaining({ priorContentHash: 'old-hash-that-will-never-match', priorRetrievedAt: '2026-10-07T00:00:00.000Z' }),
      }),
    }));
  });

  it('(b) an unchanged page produces no new EvidenceItem', async () => {
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([competitor()]);
    const text = 'Stable homepage copy';
    readMock.mockResolvedValue({ canonicalUrl: 'https://acme.test', text, retrievedAt: new Date() });
    // Prior hash exactly matches what this run computes for `text` -- precomputed via the same
    // sha256 hex digest the job itself uses, so this fixture can never accidentally pass.
    const { createHash } = await import('node:crypto');
    const sameHash = createHash('sha256').update(text).digest('hex');
    (db.evidenceItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'evidence_prior', retrievedAt: new Date(), observedMetrics: { contentHash: sameHash } });

    const result = await runCompetitorWatch('profile_1');

    expect(result.changed).toHaveLength(0);
    expect(db.evidenceItem.create).not.toHaveBeenCalled();
  });

  it('a first-ever observation (no prior EvidenceItem) stores a baseline but is not reported as a change', async () => {
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([competitor()]);
    readMock.mockResolvedValue({ canonicalUrl: 'https://acme.test', text: 'First read ever', retrievedAt: new Date() });
    (db.evidenceItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await runCompetitorWatch('profile_1');

    expect(result.changed).toHaveLength(0);
    expect(db.evidenceItem.create).toHaveBeenCalled();
  });

  it('(d) an unreachable page logs "could not check" and continues, never throwing', async () => {
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([competitor()]);
    readMock.mockRejectedValue(new Error('SSRF-blocked domain'));

    await expect(runCompetitorWatch('profile_1')).resolves.toBeDefined();
    const messages = (db.researchLogLine.create as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].data.message);
    expect(messages.some((m: string) => m.includes('could not check'))).toBe(true);
    expect(messages.some((m: string) => /no change/i.test(m))).toBe(false);
    expect(recordResearchFailure).toHaveBeenCalledWith('competitor_site');
  });

  it('(e) caps the run at 5 competitors -- a 6th is never fetched', async () => {
    const competitors = Array.from({ length: 6 }, (_, i) => competitor({ id: `comp_${i}`, name: `Competitor ${i}`, canonicalDomain: `c${i}.test` }));
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(competitors);
    readMock.mockResolvedValue({ canonicalUrl: 'https://c.test', text: 'Same text every time', retrievedAt: new Date() });
    (db.evidenceItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await runCompetitorWatch('profile_1');

    const fetchedUrls = readMock.mock.calls.map((c) => c[0].url as string);
    expect(fetchedUrls.some((u) => u.includes('c5.test'))).toBe(false);
  });

  it('fetches at most 4 pages per competitor (home, services, pricing, blog)', async () => {
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([competitor()]);
    readMock.mockResolvedValue({ canonicalUrl: 'https://acme.test', text: 'Same text every time', retrievedAt: new Date() });
    (db.evidenceItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await runCompetitorWatch('profile_1');

    expect(readMock).toHaveBeenCalledTimes(4);
  });

  it('skips a competitor with no known domain (nothing to fetch)', async () => {
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([competitor({ canonicalDomain: null })]);

    const result = await runCompetitorWatch('profile_1');

    expect(result.changed).toHaveLength(0);
    expect(readMock).not.toHaveBeenCalled();
  });

  it('returns no changes and creates no job when the client profile does not exist', async () => {
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await runCompetitorWatch('missing_profile');

    expect(result).toEqual({ changed: [] });
    expect(db.researchJob.create).not.toHaveBeenCalled();
  });
});
