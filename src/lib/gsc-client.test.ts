import { describe, it, expect, vi } from 'vitest';
import {
  extractPageUrls,
  extractPagePerformance,
  fetchSitemapUrls,
  mergeSitemapUrls,
  findPagePerformance,
  findObservedPagePerformance,
  extractDailyPerformance,
  classifyGoogleFailure,
} from './gsc-client';

describe('extractPageUrls', () => {
  it('pulls the page dimension out of a Search Console query response', () => {
    const response = {
      rows: [
        { keys: ['https://example.com/a'], clicks: 3, impressions: 40 },
        { keys: ['https://example.com/b'], clicks: 0, impressions: 12 },
      ],
    };
    expect(extractPageUrls(response)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('returns an empty array when there are no rows', () => {
    expect(extractPageUrls({})).toEqual([]);
  });
});

describe('findObservedPagePerformance', () => {
  it('returns actual metrics for a raw matching GSC row, including zeros', () => {
    expect(findObservedPagePerformance([{ url: 'https://example.com/a', impressions: 0, clicks: 0, ctr: 0 }], 'https://example.com/a'))
      .toEqual({ impressions: 0, clicks: 0, ctr: 0 });
  });

  it('returns null when raw GSC has no matching row', () => {
    expect(findObservedPagePerformance([], 'https://example.com/a')).toBeNull();
  });
});

describe('extractPagePerformance', () => {
  it('pulls url, impressions, clicks, and ctr out of a Search Console query response', () => {
    const response = {
      rows: [
        { keys: ['https://example.com/a'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 },
        { keys: ['https://example.com/b'], clicks: 0, impressions: 12, ctr: 0, position: 9.1 },
      ],
    };
    expect(extractPagePerformance(response)).toEqual([
      { url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 },
      { url: 'https://example.com/b', impressions: 12, clicks: 0, ctr: 0 },
    ]);
  });

  it('defaults missing metric fields to 0 and returns an empty array when there are no rows', () => {
    expect(extractPagePerformance({ rows: [{ keys: ['https://example.com/c'] }] })).toEqual([
      { url: 'https://example.com/c', impressions: 0, clicks: 0, ctr: 0 },
    ]);
    expect(extractPagePerformance({})).toEqual([]);
  });
});

describe('fetchSitemapUrls', () => {
  it('extracts <loc> URLs from a sitemap.xml response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>',
    });

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('excludes a sitemap index\'s own sub-sitemap entries, keeping only real page URLs', async () => {
    // Regression test for a live bug: NanoDiagnostics' queue contained an internal_link_fix
    // drafted for nanodiagnostics.com/page-sitemap.xml, a garbled draft caused by HTML parsing
    // running on an XML response. Root cause: a sitemap INDEX (e.g. WordPress/Yoast's
    // sitemap_index.xml) lists OTHER sitemap files as <loc> targets using the exact same tag
    // real page URLs use -- the old regex sweep didn't distinguish a <sitemapindex> from a
    // <urlset>, so page-sitemap.xml came back indistinguishable from a real page.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><sitemapindex>' +
        '<sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap>' +
        '<sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>' +
        '</sitemapindex>',
    });

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual([]);
  });

  it('keeps real page URLs alongside an excluded sitemap entry in the same response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><urlset>' +
        '<url><loc>https://example.com/a</loc></url>' +
        '<url><loc>https://example.com/sitemap.xml.gz</loc></url>' +
        '</urlset>',
    });

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual(['https://example.com/a']);
  });

  it('returns an empty array when the sitemap fetch fails or is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual([]);
  });

  it('returns an empty array without throwing when the fetch itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual([]);
  });
});

describe('mergeSitemapUrls', () => {
  it('adds sitemap URLs not already present as zero-metric entries', () => {
    const performance = [{ url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 }];
    const sitemapUrls = ['https://example.com/a', 'https://example.com/c'];

    const merged = mergeSitemapUrls(performance, sitemapUrls);

    expect(merged).toEqual([
      { url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 },
      { url: 'https://example.com/c', impressions: 0, clicks: 0, ctr: 0 },
    ]);
  });

  it('returns the original performance list unchanged when every sitemap URL already has GSC data', () => {
    const performance = [{ url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 }];

    const merged = mergeSitemapUrls(performance, ['https://example.com/a']);

    expect(merged).toEqual(performance);
  });
});

describe('extractDailyPerformance', () => {
  it('pulls date, clicks, impressions, and ctr out of a Search Console query response, sorted by date', () => {
    const response = {
      rows: [
        { keys: ['2026-09-15'], clicks: 5, impressions: 100, ctr: 0.05 },
        { keys: ['2026-09-13'], clicks: 2, impressions: 40, ctr: 0.05 },
      ],
    };
    expect(extractDailyPerformance(response)).toEqual([
      { date: '2026-09-13', clicks: 2, impressions: 40, ctr: 0.05 },
      { date: '2026-09-15', clicks: 5, impressions: 100, ctr: 0.05 },
    ]);
  });

  it('defaults missing metric fields to 0 and returns an empty array when there are no rows', () => {
    expect(extractDailyPerformance({ rows: [{ keys: ['2026-09-14'] }] })).toEqual([
      { date: '2026-09-14', clicks: 0, impressions: 0, ctr: 0 },
    ]);
    expect(extractDailyPerformance({})).toEqual([]);
  });
});

describe('findPagePerformance', () => {
  it('returns the matching page metrics when present', () => {
    const performance = [
      { url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 },
      { url: 'https://example.com/b', impressions: 12, clicks: 0, ctr: 0 },
    ];
    expect(findPagePerformance(performance, 'https://example.com/b')).toEqual({ impressions: 12, clicks: 0, ctr: 0 });
  });

  it('returns zeroed metrics when the page has no GSC data in this window', () => {
    const performance = [{ url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 }];
    expect(findPagePerformance(performance, 'https://example.com/missing')).toEqual({ impressions: 0, clicks: 0, ctr: 0 });
  });
});

describe('classifyGoogleFailure', () => {
  function googleError(code: string) {
    return { response: { data: { error: code } } };
  }

  it("classifies invalid_grant as 'token' -- the customer's own credential is dead", () => {
    expect(classifyGoogleFailure(googleError('invalid_grant'))).toBe('token');
  });

  it("classifies invalid_client as 'config' -- Dex's own OAuth client was rejected", () => {
    expect(classifyGoogleFailure(googleError('invalid_client'))).toBe('config');
  });

  it("classifies unauthorized_client as 'config' too", () => {
    expect(classifyGoogleFailure(googleError('unauthorized_client'))).toBe('config');
  });

  it("leaves an unrecognized error code as 'unknown' rather than guessing", () => {
    expect(classifyGoogleFailure(googleError('server_error'))).toBe('unknown');
  });

  it("leaves a bare error with no response.data.error as 'unknown'", () => {
    expect(classifyGoogleFailure(new Error('network timeout'))).toBe('unknown');
  });
});
