import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { Customer, Website } from '@prisma/client';
import { runScanForCustomer, MAX_PAGES_PER_SCAN } from './run-scan';
import { db } from '@/lib/db';
import { listPagePerformance, fetchSitemapUrls, GoogleAuthError, GoogleConfigError } from '@/lib/gsc-client';
import { fetchHtmlWithStatus, parsePageMeta, SiteBlockedError } from '@/lib/crawler';
import { flagPages } from '@/lib/growth-brain';
import { enqueueGenerationJob, claimAndRunGenerationJob } from '@/lib/generation-worker';
import { extractProfileSuggestions } from '@/lib/profile-suggestion-extractor';
import { storeProfileSuggestions } from '@/lib/profile-suggestions';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    pageSnapshot: { findUnique: vi.fn(), upsert: vi.fn() },
    scanLogLine: { create: vi.fn() },
    scanJob: { findUnique: vi.fn(() => ({ cancelRequested: false })) },
    customerFact: { findMany: vi.fn(() => []) },
    clientProfile: { findUnique: vi.fn(() => null) },
    website: { updateMany: vi.fn() },
    finding: {
      createMany: vi.fn(),
      // Echoes back the create() call's data plus a synthetic id -- run-scan.ts reads
      // f.ruleId/f.id off the resolved value to thread findingId into generation payloads.
      create: vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'finding_test_id', ...args.data })),
      // Verified-on-rescan: no prior open findings by default in these tests -- individual
      // tests for that feature live in verified-on-rescan.db.test.ts, not here.
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(),
    },
    auditLogEntry: { create: vi.fn() },
    pageLink: { createMany: vi.fn() },
  },
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(() => 'refresh-token'),
}));

vi.mock('@/lib/gsc-client', () => ({
  listPagePerformance: vi.fn(),
  fetchSitemapUrls: vi.fn(),
  GoogleAuthError: class GoogleAuthError extends Error {},
  GoogleConfigError: class GoogleConfigError extends Error {},
  mergeSitemapUrls: vi.fn((performance: { url: string }[], sitemapUrls: string[]) => {
    const existing = new Set(performance.map((p) => p.url));
    const supplemental = sitemapUrls
      .filter((url) => !existing.has(url))
      .map((url) => ({ url, impressions: 0, clicks: 0, ctr: 0 }));
    return [...performance, ...supplemental];
  }),
}));

vi.mock('@/lib/crawler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crawler')>();
  return {
    ...actual,
    fetchHtml: vi.fn(async (url: string) => `<html>${url}</html>`),
    // Mocked so run-scan.ts's real per-page loop (which calls this, not fetchHtml, directly)
    // doesn't fall through to the real implementation and hit real network/DNS for fake test
    // URLs like `gsc-0`/`sitemap-only-0` -- same benign default as the fetchHtml mock above.
    fetchHtmlWithStatus: vi.fn(async (url: string) => ({ html: `<html>${url}</html>`, status: 200, blockedByRobots: false })),
    parsePageMeta: vi.fn((html: string) => ({ title: `Title for ${html}`, h1: null, metaDescription: null })),
    // Benign by default (no missing signal) so tests unrelated to the SEO Specialist don't
    // incidentally trigger Finding creation.
    parseSeoSignals: vi.fn(() => ({ canonicalUrl: 'https://example.com/', hasStructuredData: true, internalLinkCount: 1 })),
    // Mocked so no test makes a real network call — real implementation calls safeFetch (DNS +
    // undici) which would otherwise hit example.com for real on every single test.
    fetchRobotsTxtForOrigin: vi.fn(async () => ''),
  };
});

vi.mock('@/lib/growth-brain', () => ({
  flagPages: vi.fn(() => []),
}));

// Phase 2F S4: real extraction calls a real model and real storeProfileSuggestions needs a real
// db.profileSuggestion/db.website — neither exists in this file's db mock. Defaults to no-ops so
// every pre-existing test (none of which asserts on Marketing Memory) is unaffected; the
// dedicated describe block below overrides these per test.
vi.mock('@/lib/profile-suggestion-extractor', () => ({
  extractProfileSuggestions: vi.fn(async () => []),
  PROFILE_SUGGESTION_MODEL: 'test-model',
  PROFILE_SUGGESTION_PROMPT_VERSION: 'test-v1',
}));
vi.mock('@/lib/profile-suggestions', () => ({
  storeProfileSuggestions: vi.fn(async () => ({ count: 0 })),
}));

// Phase 1C: run-scan.ts's own job is deciding WHETHER to enqueue a generation job (the dedup
// checks below, unchanged by Phase 1C) and reacting to the job's outcome -- the actual
// generate+guard+write pipeline these actionTypes used to call inline now lives in
// generation-worker.ts/generation-dispatch.ts, covered by their own test files. Mocking this
// module keeps these tests scoped to run-scan.ts's real responsibility, and as a side effect
// means no test here touches the real db.generationJob/providerCircuitBreaker tables at all.
vi.mock('@/lib/generation-worker', () => ({
  enqueueGenerationJob: vi.fn(async () => ({ id: 'genjob_default' })),
  claimAndRunGenerationJob: vi.fn(async () => ({ processed: true, outcome: 'completed' })),
}));

const CUSTOMER = { id: 'cust_1' } as Customer;
const WEBSITE = {
  id: 'web_1',
  gscRefreshToken: 'encrypted',
  gscReconnectRequired: false,
  gscPropertyUrl: 'sc-domain:example.com',
  url: 'https://example.com',
  autoExecuteEnabled: false,
} as Website;

function gscPages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/gsc-${i}`,
    impressions: 10,
    clicks: 1,
    ctr: 0.1,
  }));
}

function sitemapUrls(count: number) {
  return Array.from({ length: count }, (_, i) => `https://example.com/sitemap-only-${i}`);
}

describe('runScanForCustomer — sitemap quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags the website reconnect-required when Google rejects the token, then rethrows', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockRejectedValue(new GoogleAuthError('invalid_grant'));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(runScanForCustomer(CUSTOMER, WEBSITE)).rejects.toThrow(GoogleAuthError);

    expect(db.website.updateMany).toHaveBeenCalledWith({
      where: { id: 'web_1', gscRefreshToken: 'encrypted' },
      data: { gscReconnectRequired: true },
    });
  });

  it('also flags reconnect-required when Google rejects Dex\'s own OAuth client config, not just a dead customer token', async () => {
    // Regression test for a live bug: example.com's Settings badge stayed green "Search
    // Console connected" through 17 consecutive days of this exact failure, because the old
    // catch block only recognized GoogleAuthError, not GoogleConfigError.
    (listPagePerformance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GoogleConfigError("Dex's Google OAuth client configuration was rejected")
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(runScanForCustomer(CUSTOMER, WEBSITE)).rejects.toThrow(GoogleConfigError);

    expect(db.website.updateMany).toHaveBeenCalledWith({
      where: { id: 'web_1', gscRefreshToken: 'encrypted' },
      data: { gscReconnectRequired: true },
    });
  });

  it('queries Google using the resolved GSC property, not the crawl url', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(listPagePerformance).toHaveBeenCalledWith('refresh-token', 'sc-domain:example.com');
  });

  it('backfills unused sitemap-reserve slots with GSC pages when no sitemap-only URLs exist', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(MAX_PAGES_PER_SCAN + 5));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.pagesAttempted).toBe(MAX_PAGES_PER_SCAN);
    expect(result.pagesScanned).toBe(MAX_PAGES_PER_SCAN);
    expect(fetchHtmlWithStatus).toHaveBeenCalledTimes(MAX_PAGES_PER_SCAN);
  });

  it('reports pagesAttempted separately from pagesScanned when some pages return no usable meta', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(5));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (parsePageMeta as ReturnType<typeof vi.fn>).mockImplementation((html: string) =>
      html.includes('gsc-0') || html.includes('gsc-1')
        ? { title: null, h1: null, metaDescription: null }
        : { title: 'Title', h1: 'H1', metaDescription: 'Meta' }
    );

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.pagesAttempted).toBe(5);
    expect(result.pagesScanned).toBe(3);

    // Restore the suite's default parsePageMeta implementation — clearAllMocks in
    // beforeEach resets call history but not a mockImplementation override.
    (parsePageMeta as ReturnType<typeof vi.fn>).mockImplementation((html: string) => ({
      title: `Title for ${html}`,
      h1: null,
      metaDescription: null,
    }));
  });

  it('includes sitemap-only pages up to the reserve without dropping them for a large GSC list', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(MAX_PAGES_PER_SCAN + 5));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(sitemapUrls(3));

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.pagesScanned).toBe(MAX_PAGES_PER_SCAN);
    const fetchedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(fetchedUrls.filter((url) => url.includes('sitemap-only'))).toHaveLength(3);
    expect(fetchedUrls.filter((url) => url.includes('gsc-'))).toHaveLength(MAX_PAGES_PER_SCAN - 3);
  });

  it('caps sitemap-only pages at the reserve and backfills the rest from GSC', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(MAX_PAGES_PER_SCAN + 5));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(sitemapUrls(10));

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.pagesScanned).toBe(MAX_PAGES_PER_SCAN);
    const fetchedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(fetchedUrls.filter((url) => url.includes('sitemap-only'))).toHaveLength(5);
    expect(fetchedUrls.filter((url) => url.includes('gsc-'))).toHaveLength(MAX_PAGES_PER_SCAN - 5);
  });

  it('logs a step line for the pages-found checkpoint when a scanJobId is provided', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(3));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, WEBSITE, 'job_123');

    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_123', message: 'Found 3 pages to check.' },
    });
  });

  it('does not call scanLogLine.create when no scanJobId is given', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(3));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.scanLogLine.create).not.toHaveBeenCalled();
  });

  it('stops mid-crawl and reports cancelled when cancelRequested is set', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(5));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (db.scanJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ cancelRequested: true });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE, 'job_cancel');

    expect(result.cancelled).toBe(true);
    expect(result.pagesScanned).toBe(0);
    expect(fetchHtmlWithStatus).not.toHaveBeenCalled();
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_cancel', message: 'Cancelled by user.' },
    });

    // Restore the suite's default — clearAllMocks in beforeEach resets call history but not
    // a mockResolvedValue override (see the parsePageMeta restore above for the same reason).
    (db.scanJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ cancelRequested: false });
  });

  it('does not check cancellation when no scanJobId is given', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(3));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.cancelled).toBe(false);
    expect(db.scanJob.findUnique).not.toHaveBeenCalled();
  });
});

describe('runScanForCustomer — SEO status-code findings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a broken_page_status Finding for a page that returns a real error status, and skips further processing', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: null, status: 404, blockedByRobots: false });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.finding.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          agent: 'seo_specialist',
          ruleId: 'broken_page_status',
          severity: 'medium',
          evidence: { pageUrl: 'https://example.com/gsc-0', statusCode: 404 },
        }),
      ],
    });
    // No usable HTML for this page — meta/other agents correctly never run on it.
    expect(result.pagesScanned).toBe(0);
    expect(result.findingsCreated).toBe(1);
  });

  it('does not create a status finding for a real 2xx response', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html>ok</html>', status: 200, blockedByRobots: false });

    await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.finding.createMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ ruleId: 'broken_page_status' })]) })
    );
  });
});

describe('runScanForCustomer — deterministic remediation (canonical_fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html>page</html>', status: 200, blockedByRobots: false });
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'A page', h1: 'A page', metaDescription: 'desc' });
  });

  it('enqueues and runs a canonical_fix generation job when the SEO Specialist finds a missing canonical', async () => {
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: null, hasStructuredData: true, internalLinkCount: 1 });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.action.findFirst).toHaveBeenCalledWith({
      where: { websiteId: WEBSITE.id, pageUrl: 'https://example.com/gsc-0', actionType: 'canonical_fix' },
    });
    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'canonical_fix',
        targetRef: 'https://example.com/gsc-0',
        payload: { actionType: 'canonical_fix', pageUrl: 'https://example.com/gsc-0', currentCanonical: null, findingId: 'finding_test_id' },
      })
    );
    expect(claimAndRunGenerationJob).toHaveBeenCalledWith('genjob_default');
    expect(result.deterministicActionsCreated).toBe(1);
  });

  it('enqueues a canonical_fix job carrying the invalid canonical as currentCanonical when present but unparseable', async () => {
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({
      canonicalUrl: 'http://exa mple.com/bad host',
      hasStructuredData: true,
      internalLinkCount: 1,
    });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ actionType: 'canonical_fix', currentCanonical: 'http://exa mple.com/bad host' }),
      })
    );
    expect(result.deterministicActionsCreated).toBe(1);
  });

  it('does not enqueue a second canonical_fix job when an Action already exists for this page', async () => {
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: null, hasStructuredData: true, internalLinkCount: 1 });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_existing' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(result.deterministicActionsCreated).toBe(0);
  });

  it('does not touch canonical_fix at all when the canonical is present and self-referencing', async () => {
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({
      canonicalUrl: 'https://example.com/gsc-0',
      hasStructuredData: true,
      internalLinkCount: 1,
    });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.action.findFirst).not.toHaveBeenCalled();
    expect(result.deterministicActionsCreated).toBe(0);
  });

  it('does not count the job toward deterministicActionsCreated when generation does not complete', async () => {
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: null, hasStructuredData: true, internalLinkCount: 1 });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true, outcome: 'blocked' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.deterministicActionsCreated).toBe(0);
  });
});

describe('runScanForCustomer — deterministic remediation (structured_data_fix, entity_markup_fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html>page</html>', status: 200, blockedByRobots: false });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it('enqueues and runs a structured_data_fix job when the SEO Specialist finds no structured data', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'Pricing', h1: 'Pricing', metaDescription: 'desc' });
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/gsc-0', hasStructuredData: false, internalLinkCount: 1 });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.action.findFirst).toHaveBeenCalledWith({
      where: { websiteId: WEBSITE.id, pageUrl: 'https://example.com/gsc-0', actionType: 'structured_data_fix' },
    });
    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'structured_data_fix',
        targetRef: 'https://example.com/gsc-0',
        payload: { actionType: 'structured_data_fix', pageUrl: 'https://example.com/gsc-0', title: 'Pricing', findingId: 'finding_test_id' },
      })
    );
    expect(result.deterministicActionsCreated).toBe(1);
  });

  it('does not enqueue a second structured_data_fix job when one already exists for this page', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'Pricing', h1: 'Pricing', metaDescription: 'desc' });
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/gsc-0', hasStructuredData: false, internalLinkCount: 1 });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_existing' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(result.deterministicActionsCreated).toBe(0);
  });

  it('enqueues an entity_markup_fix job for the homepage', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: WEBSITE.url, impressions: 10, clicks: 1, ctr: 0.1 }]);
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'Home', h1: 'Home', metaDescription: 'desc' });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [], name: 'Acme Inc' });
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: WEBSITE.url, hasStructuredData: true, internalLinkCount: 1 });
    // hasEntityMarkup is not overridden by this file's crawler mock, so the real implementation
    // runs against the fixture html above (no JSON-LD present) -- correctly finds none.

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'entity_markup_fix',
        targetRef: WEBSITE.url,
        // The customer's ClientProfile.name is fetched fresh by generation-worker.ts's own
        // context-building, not baked into the payload -- see generation-dispatch.ts.
        payload: { actionType: 'entity_markup_fix', pageUrl: WEBSITE.url, findingId: 'finding_test_id' },
      })
    );
    expect(result.deterministicActionsCreated).toBe(1);
  });

  it('does not enqueue entity_markup_fix for a non-homepage page even when structured data is present', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'Pricing', h1: 'Pricing', metaDescription: 'desc' });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [], name: 'Acme Inc' });
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/gsc-0', hasStructuredData: true, internalLinkCount: 1 });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalledWith(expect.objectContaining({ actionType: 'entity_markup_fix' }));
    expect(result.deterministicActionsCreated).toBe(0);
  });
});

describe('runScanForCustomer — Live Site Graph page-link persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists real internal-link edges found on a crawled page, scoped to the scan job', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      html: '<html><body><a href="/about">About</a><a href="https://example.com/contact">Contact</a></body></html>',
      status: 200,
      blockedByRobots: false,
    });

    await runScanForCustomer(CUSTOMER, WEBSITE, 'job_graph');

    expect(db.pageLink.createMany).toHaveBeenCalledWith({
      data: [
        { websiteId: 'web_1', scanJobId: 'job_graph', fromUrl: 'https://example.com/gsc-0', toUrl: 'https://example.com/about' },
        { websiteId: 'web_1', scanJobId: 'job_graph', fromUrl: 'https://example.com/gsc-0', toUrl: 'https://example.com/contact' },
      ],
    });
  });

  it('does not call pageLink.createMany for a page with no internal links', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html><body>no links here</body></html>', status: 200, blockedByRobots: false });

    await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.pageLink.createMany).not.toHaveBeenCalled();
  });
});

describe('runScanForCustomer — restricted wording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks crawled page copy against this website\'s own tenant-scoped restricted-wording list, not an unscoped or unrelated one', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      html: '<html><body>We offer guaranteed results.</body></html>',
      status: 200,
      blockedByRobots: false,
    });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: ['guaranteed'] });

    await runScanForCustomer(CUSTOMER, WEBSITE);

    // Reuses the existing clientProfile query already scoped by website.clientProfileId --
    // no second, unscoped preference lookup was introduced for this check.
    expect(db.clientProfile.findUnique).toHaveBeenCalledTimes(1);
    expect(db.finding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ agent: 'brand_specialist', ruleId: 'restricted_wording_found' }),
      })
    );

    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it('creates no restricted-wording finding when the client profile has none configured', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      html: '<html><body>We offer guaranteed results.</body></html>',
      status: 200,
      blockedByRobots: false,
    });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [] });

    await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.finding.createMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ ruleId: 'restricted_wording_found' })]),
      })
    );

    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });
});

describe('runScanForCustomer — automatically draftable (restricted_wording_fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      html: '<html><body>We offer guaranteed results for everyone.</body></html>',
      status: 200,
      blockedByRobots: false,
    });
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'Pricing', h1: 'Pricing', metaDescription: 'desc' });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: ['guaranteed results'], name: 'Acme' });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it('enqueues and runs a restricted_wording_fix job carrying the matched phrase/excerpt', async () => {
    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'restricted_wording_fix',
        targetRef: 'https://example.com/gsc-0',
        payload: expect.objectContaining({
          actionType: 'restricted_wording_fix',
          matches: [expect.objectContaining({ phrase: 'guaranteed results' })],
        }),
      })
    );
    expect(claimAndRunGenerationJob).toHaveBeenCalledWith('genjob_default');
    expect(result.draftsCreated).toBe(1);
  });

  it('does not redraft when a succeeded pending restricted_wording_fix already exists for this page', async () => {
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_existing' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(result.draftsCreated).toBe(0);
  });

  it('records an error and does not count a draft when the job does not complete', async () => {
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true, outcome: 'failed' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.draftsCreated).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('does not touch restricted_wording_fix at all when no restricted wording is configured', async () => {
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [], name: 'Acme' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(result.draftsCreated).toBe(0);
  });
});

describe('runScanForCustomer — automatically draftable (internal_link_fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html>page</html>', status: 200, blockedByRobots: false });
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'A page', h1: 'A page', metaDescription: 'desc' });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it('enqueues and runs an internal-link-fix job for each zero-link page, grounded in the other real pages this scan crawled', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(2));
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/', hasStructuredData: true, internalLinkCount: 0 });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'internal_link_fix',
        targetRef: 'https://example.com/gsc-0',
        payload: expect.objectContaining({
          actionType: 'internal_link_fix',
          targetUrl: 'https://example.com/gsc-0',
          candidates: expect.arrayContaining([expect.objectContaining({ url: 'https://example.com/gsc-1' })]),
        }),
      })
    );
    expect(result.draftsCreated).toBe(2);
  });

  it('skips a zero-link page when no other real page exists on the site to suggest', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(1));
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/', hasStructuredData: true, internalLinkCount: 0 });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(result.draftsCreated).toBe(0);
  });

  it('does not redraft when a succeeded pending internal_link_fix already exists for this page', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(2));
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/', hasStructuredData: true, internalLinkCount: 0 });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_existing' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(result.draftsCreated).toBe(0);
  });

  it('records an error and does not count a draft when the job does not complete', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(2));
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/', hasStructuredData: true, internalLinkCount: 0 });
    // Both zero-link pages in this test must fail consistently, so this overrides the mock's
    // default beyond just one call -- restored below since clearAllMocks() in beforeEach clears
    // call history, not a standing mockResolvedValue override, and later tests need the default.
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true, outcome: 'failed' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(result.draftsCreated).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);

    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true, outcome: 'completed' });
  });

  it('does not touch internal_link_fix at all when the page already has internal links', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(2));
    const { parseSeoSignals } = await import('@/lib/crawler');
    (parseSeoSignals as ReturnType<typeof vi.fn>).mockReturnValue({ canonicalUrl: 'https://example.com/', hasStructuredData: true, internalLinkCount: 3 });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(result.draftsCreated).toBe(0);
  });
});

describe('runScanForCustomer — content drift baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FLAGGED_PAGE = {
    url: 'https://example.com/gsc-0',
    title: 'Old Title',
    metaDescription: null as string | null,
    h1: null as string | null,
    impressions: 10,
    clicks: 1,
    ctr: 0.1,
    flagReason: 'Missing meta description.',
  };

  function stubOnePageScan() {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue([
      { url: FLAGGED_PAGE.url, impressions: 10, clicks: 1, ctr: 0.1 },
    ]);
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html>fixture</html>', status: 200, blockedByRobots: false });
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({
      title: FLAGGED_PAGE.title,
      metaDescription: FLAGGED_PAGE.metaDescription,
      h1: FLAGGED_PAGE.h1,
    });
    (flagPages as ReturnType<typeof vi.fn>).mockReturnValue([FLAGGED_PAGE]);
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  }

  function expectedHash() {
    return createHash('sha256')
      .update(
        JSON.stringify({ title: FLAGGED_PAGE.title, metaDescription: FLAGGED_PAGE.metaDescription, h1: FLAGGED_PAGE.h1 })
      )
      .digest('hex');
  }

  it('skips drafting when the page content hash matches an existing snapshot, even for a previously rejected page', async () => {
    stubOnePageScan();
    (db.pageSnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      websiteId: WEBSITE.id,
      pageUrl: FLAGGED_PAGE.url,
      contentHash: expectedHash(),
    });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(db.pageSnapshot.upsert).not.toHaveBeenCalled();
    expect(result.draftsCreated).toBe(0);
  });

  it('enqueues and runs a meta_description job, then upserts a fresh snapshot, when no snapshot exists yet', async () => {
    stubOnePageScan();
    (db.pageSnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await runScanForCustomer(CUSTOMER, WEBSITE, 'job_123');

    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'meta_description',
        targetRef: FLAGGED_PAGE.url,
        payload: {
          actionType: 'meta_description',
          url: FLAGGED_PAGE.url,
          title: FLAGGED_PAGE.title,
          metaDescription: FLAGGED_PAGE.metaDescription,
          h1: FLAGGED_PAGE.h1,
          findingId: null,
        },
      })
    );
    expect(db.pageSnapshot.upsert).toHaveBeenCalledWith({
      where: { websiteId_pageUrl: { websiteId: WEBSITE.id, pageUrl: FLAGGED_PAGE.url } },
      create: { customerId: CUSTOMER.id, websiteId: WEBSITE.id, pageUrl: FLAGGED_PAGE.url, contentHash: expectedHash() },
      update: { contentHash: expectedHash(), capturedAt: expect.any(Date) },
    });
    expect(result.draftsCreated).toBe(1);
  });

  it('drafts again when the stored snapshot hash differs from the current content (real drift)', async () => {
    stubOnePageScan();
    (db.pageSnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      websiteId: WEBSITE.id,
      pageUrl: FLAGGED_PAGE.url,
      contentHash: 'stale-hash-from-before-the-page-changed',
    });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).toHaveBeenCalledTimes(1);
    expect(db.pageSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(result.draftsCreated).toBe(1);
  });

  it('does not upsert a snapshot when the job does not complete, so the same content is retried next scan', async () => {
    stubOnePageScan();
    (db.pageSnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true, outcome: 'failed' });

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(db.pageSnapshot.upsert).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].url).toBe(FLAGGED_PAGE.url);
  });

  it('does not skip a page whose only pending Action failed generation (dedup only blocks on a succeeded draft)', async () => {
    stubOnePageScan();
    // Call order: alreadyPending (generationStatus: 'succeeded' -> none found), recentlyDecided
    // (unrelated -> none). Enqueueing itself, not a lookup here, is what resumes a failed job --
    // see metaDescriptionFingerprint's idempotency-key comment in run-scan.ts.
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const result = await runScanForCustomer(CUSTOMER, WEBSITE);

    expect(enqueueGenerationJob).toHaveBeenCalledTimes(1);
    expect(result.draftsCreated).toBe(1);
  });
});

describe('runScanForCustomer — without GSC', () => {
  const NO_GSC_WEBSITE = {
    id: 'web_1',
    gscRefreshToken: null,
    gscReconnectRequired: false,
    gscPropertyUrl: null,
    url: 'https://example.com',
    autoExecuteEnabled: false,
  } as Website;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never calls listPagePerformance when there is no GSC token', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: null, status: null, blockedByRobots: false });
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(['https://example.com/sitemap-page']);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    expect(listPagePerformance).not.toHaveBeenCalled();
  });

  it('excludes a sitemap link discovered via the homepage\'s own HTML from the discovered-page list', async () => {
    // Regression test for a live bug: an SEO plugin's footer "XML Sitemap" link makes
    // page-sitemap.xml show up in extractInternalLinks' output exactly like a real page --
    // discoverPagesWithoutGsc must filter it back out, same as it does for fetchSitemapUrls'
    // own output, so it's never fetched and HTML-parsed as if it were a real page.
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com'
        ? {
            html: '<html><body><a href="/about">About</a><a href="/page-sitemap.xml">XML Sitemap</a></body></html>',
            status: 200,
            blockedByRobots: false,
          }
        : { html: `<html>${url}</html>`, status: 200, blockedByRobots: false }
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    const scannedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(scannedUrls).toContain('https://example.com/about');
    expect(scannedUrls).not.toContain('https://example.com/page-sitemap.xml');
  });

  it('discovers pages from homepage internal links and the sitemap', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com'
        ? {
            html: '<html><body><a href="/about">About</a><a href="https://example.com/contact">Contact</a></body></html>',
            status: 200,
            blockedByRobots: false,
          }
        : { html: `<html>${url}</html>`, status: 200, blockedByRobots: false }
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    const scannedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(scannedUrls).toContain('https://example.com');
    expect(scannedUrls).toContain('https://example.com/about');
    expect(scannedUrls).toContain('https://example.com/contact');
  });

  // Page-identity fix (overseer, 2026-10-17, live on Yoki): the bare domain and its trailing-
  // slash form must collapse to one scanned page, not two Finding-producing visits.
  it('treats the bare domain and its trailing-slash form as one page, scanned only once', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com'
        ? { html: '<html><body><a href="https://example.com/">Home</a></body></html>', status: 200, blockedByRobots: false }
        : { html: `<html>${url}</html>`, status: 200, blockedByRobots: false }
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    const scannedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    // The homepage is legitimately fetched twice for unrelated reasons (once for discovery's
    // own link extraction, once for the main per-page scan loop) -- the real assertion is that
    // the trailing-slash form never appears as a second, separately-scanned page identity.
    expect(scannedUrls).not.toContain('https://example.com/');
  });

  it('falls back to sitemap URLs plus the homepage itself when the homepage fetch fails with no status (transient network failure)', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: null, status: null, blockedByRobots: false });
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(['https://example.com/sitemap-page']);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    const scannedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(scannedUrls).toContain('https://example.com');
    expect(scannedUrls).toContain('https://example.com/sitemap-page');
  });

  it('caps page discovery at MAX_PAGES_PER_SCAN', async () => {
    const manyLinks = Array.from({ length: MAX_PAGES_PER_SCAN + 10 }, (_, i) => `<a href="/page-${i}">Page ${i}</a>`).join('');
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com'
        ? { html: `<html><body>${manyLinks}</body></html>`, status: 200, blockedByRobots: false }
        : { html: `<html>${url}</html>`, status: 200, blockedByRobots: false }
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    // discoverPagesWithoutGsc's own .slice(0, MAX_PAGES_PER_SCAN) already includes the
    // homepage as one of the discovered pages, so no +1 for the main scan loop. +1 here is the
    // discovery phase's own homepage fetch (now via fetchHtmlWithStatus, to detect a blocked
    // homepage) -- the homepage was always fetched twice in total, this only changed which
    // function the discovery-phase fetch goes through.
    expect((fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(MAX_PAGES_PER_SCAN + 1);
  });

  it('throws SiteBlockedError when the homepage returns a real 4xx/5xx and nothing else was discoverable', async () => {
    // Real production evidence 2026-09-17: decathlon.co.uk and bershka.com both returned
    // HTTP 403 on their homepage, with sitemap.xml yielding nothing either.
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: null, status: 403, blockedByRobots: false });
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE)).rejects.toThrow(SiteBlockedError);
    await expect(runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE)).rejects.toThrow(/HTTP 403/);
  });

  it('throws SiteBlockedError when robots.txt disallows Dex and nothing else was discoverable', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: null, status: null, blockedByRobots: true });
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE)).rejects.toThrow(SiteBlockedError);
    await expect(runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE)).rejects.toThrow(/robots\.txt disallows/);
  });

  it('does not throw when the homepage is blocked but the sitemap still yields real pages', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: null, status: 403, blockedByRobots: false });
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(['https://example.com/sitemap-page']);

    await expect(runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE)).resolves.toBeDefined();
  });

  it('excludes auth/account pages discovered via internal links from the scanned-page list', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com'
        ? {
            html: '<html><body><a href="/about">About</a><a href="/sign-in">Sign in</a><a href="/account/orders">Orders</a></body></html>',
            status: 200,
            blockedByRobots: false,
          }
        : { html: `<html>${url}</html>`, status: 200, blockedByRobots: false }
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    const scannedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(scannedUrls).toContain('https://example.com/about');
    expect(scannedUrls).not.toContain('https://example.com/sign-in');
    expect(scannedUrls).not.toContain('https://example.com/account/orders');
  });

  it('skips a page whose own HTML marks it noindex, without counting it toward pagesScanned', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com'
        ? { html: '<html><body><a href="/about">About</a><a href="/draft-page">Draft</a></body></html>', status: 200, blockedByRobots: false }
        : url === 'https://example.com/draft-page'
          ? { html: '<html><head><meta name="robots" content="noindex"></head></html>', status: 200, blockedByRobots: false }
          : { html: `<html>${url}</html>`, status: 200, blockedByRobots: false }
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (parsePageMeta as ReturnType<typeof vi.fn>).mockImplementation((html: string) => ({ title: `Title for ${html}`, h1: null, metaDescription: null }));

    const result = await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    // Still attempted (it was fetched), but not counted as scanned -- same honest-skip
    // convention as a page whose fetch returns no usable html.
    const scannedUrls = (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(scannedUrls).toContain('https://example.com/draft-page');
    expect(result.pagesScanned).toBeLessThan(result.pagesAttempted);
  });

  // Verified-on-rescan (docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md):
  // full tests for resolution logic live in verified-on-rescan.db.test.ts -- this just confirms
  // the scan loop actually calls the resolver with the right per-page signals.
  it('resolves a prior open finding fixed when the same page no longer triggers that rule, given a scanJobId', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      html: '<html><head><link rel="canonical" href="https://example.com"><title>T</title><meta name="description" content="d"></head><body><h1>H</h1></body></html>',
      status: 200,
      blockedByRobots: false,
    });
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (parsePageMeta as ReturnType<typeof vi.fn>).mockReturnValue({ title: 'T', h1: 'H', metaDescription: 'd' });
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'prior_finding_1', ruleId: 'missing_canonical', pageUrl: 'https://example.com', evidence: {} },
    ]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE, 'scan_job_1');

    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'prior_finding_1' },
      data: expect.objectContaining({ resolution: 'fixed', resolvedByScanJobId: 'scan_job_1' }),
    }));
    expect(db.auditLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'finding_resolved_on_rescan' }),
    }));
  });
});

describe('runScanForCustomer — Phase 2F S4 Marketing Memory extraction', () => {
  const PROFILE_WEBSITE = {
    id: 'web_1',
    gscRefreshToken: null,
    gscReconnectRequired: false,
    gscPropertyUrl: null,
    url: 'https://example.com',
    clientProfileId: 'profile_1',
    autoExecuteEnabled: false,
  } as Website;

  beforeEach(() => {
    vi.clearAllMocks();
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(['https://example.com/about']);
  });

  it('sends evidence-page text from an eligible crawled page to extraction and stores the result', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com/about'
        ? { html: '<html><body><p>We make paper for independent shops.</p></body></html>', status: 200, blockedByRobots: false }
        : { html: '<html><body></body></html>', status: 200, blockedByRobots: false }
    );
    const proposals = [{ field: 'audience', value: 'Independent shops', sourceUrl: 'https://example.com/about', sourceExcerpt: 'We make paper for independent shops.' }];
    (extractProfileSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue(proposals);
    (storeProfileSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await runScanForCustomer(CUSTOMER, PROFILE_WEBSITE);

    expect(extractProfileSuggestions).toHaveBeenCalledTimes(1);
    const sentPages = (extractProfileSuggestions as ReturnType<typeof vi.fn>).mock.calls[0][0] as { url: string; text: string }[];
    expect(sentPages.some((p) => p.url === 'https://example.com/about' && p.text.includes('independent shops'))).toBe(true);

    expect(storeProfileSuggestions).toHaveBeenCalledWith(
      { customerId: CUSTOMER.id, clientProfileId: 'profile_1', websiteId: 'web_1' },
      proposals, sentPages, expect.objectContaining({ modelVersion: 'test-model', promptVersion: 'test-v1' }),
    );
    expect(result.profileSuggestionsCreated).toBe(1);
  });

  it('does not fail the scan when extraction throws', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html><body><p>Copy</p></body></html>', status: 200, blockedByRobots: false });
    (extractProfileSuggestions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('model unavailable'));

    const result = await runScanForCustomer(CUSTOMER, PROFILE_WEBSITE);

    expect(result.profileSuggestionsCreated).toBe(0);
    expect(storeProfileSuggestions).not.toHaveBeenCalled();
  });

  it('skips extraction entirely when no crawled page qualifies as evidence', async () => {
    // Homepage fetch fails (so it never reaches the evidence-collection check at all) and the
    // only other discovered page is a non-qualifying blog path -- no page this scan actually
    // read should end up as evidence.
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(['https://example.com/blog/post-1']);
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com'
        ? { html: null, status: 200, blockedByRobots: false }
        : { html: '<html><body><p>Copy</p></body></html>', status: 200, blockedByRobots: false }
    );

    await runScanForCustomer(CUSTOMER, PROFILE_WEBSITE);

    expect(extractProfileSuggestions).not.toHaveBeenCalled();
  });

  it('adds a socialProfiles proposal when an evidence page carries a social link (social-profile-discovery plan, 2026-10-17)', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url === 'https://example.com/about'
        ? { html: '<html><body><footer><a href="https://www.linkedin.com/company/acme">LinkedIn</a></footer></body></html>', status: 200, blockedByRobots: false }
        : { html: '<html><body></body></html>', status: 200, blockedByRobots: false }
    );
    (extractProfileSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (storeProfileSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    await runScanForCustomer(CUSTOMER, PROFILE_WEBSITE);

    const callArgs = (storeProfileSuggestions as ReturnType<typeof vi.fn>).mock.calls[0];
    const proposals = callArgs[1] as { field: string; value: unknown }[];
    const socialProposal = proposals.find((p) => p.field === 'socialProfiles');
    expect(socialProposal?.value).toEqual([{ platform: 'linkedin', url: 'https://www.linkedin.com/company/acme' }]);
  });

  it('does not add a socialProfiles proposal when no evidence page carries a social link', async () => {
    (fetchHtmlWithStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ html: '<html><body><p>Copy</p></body></html>', status: 200, blockedByRobots: false });
    (extractProfileSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (storeProfileSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await runScanForCustomer(CUSTOMER, PROFILE_WEBSITE);

    const callArgs = (storeProfileSuggestions as ReturnType<typeof vi.fn>).mock.calls[0];
    const proposals = callArgs[1] as { field: string }[];
    expect(proposals.find((p) => p.field === 'socialProfiles')).toBeUndefined();
  });
});
