import { google, searchconsole_v1 } from 'googleapis';
import { client } from './google-oauth';
import { safeFetch } from '@/lib/safe-fetch';
import { isSitemapUrl } from '@/lib/crawler';

// Same rationale as crawler.ts's defaultFetch: real (non-test) sitemap fetches go through the
// SSRF-safe path; tests inject their own fetchImpl and never reach this.
const defaultFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const result = await safeFetch(String(input), {
    headers: init?.headers as Record<string, string> | undefined,
  });
  return { ok: result.ok, status: result.status, text: result.text } as Response;
}) as typeof fetch;

type SearchAnalyticsResponse = searchconsole_v1.Schema$SearchAnalyticsQueryResponse;

export interface PagePerformance {
  url: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export function extractPagePerformance(response: SearchAnalyticsResponse): PagePerformance[] {
  return (response.rows ?? [])
    .filter((row) => Boolean(row.keys?.[0]))
    .map((row) => ({
      url: row.keys![0] as string,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
    }));
}

export function extractPageUrls(response: SearchAnalyticsResponse): string[] {
  return extractPagePerformance(response).map((page) => page.url);
}

const LOOKBACK_DAYS = 28;
const REPORTING_LAG_DAYS = 3; // GSC Search Analytics data typically lags 2-3 days behind real-time
const ROW_LIMIT = 100;

async function queryAnalyticsForRange(
  refreshToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit: number
): Promise<SearchAnalyticsResponse> {
  const auth = client();
  auth.setCredentials({ refresh_token: refreshToken });

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  try {
    const { data } = await withTimeout(
      searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate,
          endDate,
          dimensions,
          rowLimit,
        },
      }),
      GOOGLE_API_TIMEOUT_MS,
      'Google Search Console searchanalytics.query'
    );
    return data;
  } catch (err) {
    const kind = classifyGoogleFailure(err);
    if (kind === 'token') throw new GoogleAuthError('Google rejected this Search Console connection');
    if (kind === 'config') throw new GoogleConfigError("Dex's Google OAuth client configuration was rejected");
    throw err;
  }
}

export async function getPagePerformanceForRange(
  refreshToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<PagePerformance[]> {
  return extractPagePerformance(
    await queryAnalyticsForRange(refreshToken, siteUrl, startDate, endDate, ['page'], ROW_LIMIT)
  );
}

export interface DailyPerformance {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
}

export function extractDailyPerformance(response: SearchAnalyticsResponse): DailyPerformance[] {
  return (response.rows ?? [])
    .filter((row) => Boolean(row.keys?.[0]))
    .map((row) => ({
      date: row.keys![0] as string,
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Real day-by-day search performance (Analytics tab's trend chart) -- only ever called when
// a resolved GSC connection exists (see the dashboard page's own gate); a day Google returns
// no row for is left absent here, not defaulted to zero, so a caller can tell "measured zero"
// from "Google has no row for this date" if that distinction ever matters.
export async function getPerformanceTrend(refreshToken: string, siteUrl: string, days: number = LOOKBACK_DAYS): Promise<DailyPerformance[]> {
  const endDate = new Date(Date.now() - REPORTING_LAG_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - (days + REPORTING_LAG_DAYS) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return extractDailyPerformance(
    await queryAnalyticsForRange(refreshToken, siteUrl, startDate, endDate, ['date'], Math.min(days, ROW_LIMIT))
  );
}

export async function listPagePerformance(refreshToken: string, siteUrl: string): Promise<PagePerformance[]> {
  const endDate = new Date(Date.now() - REPORTING_LAG_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - (LOOKBACK_DAYS + REPORTING_LAG_DAYS) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return getPagePerformanceForRange(refreshToken, siteUrl, startDate, endDate);
}

export async function listIndexedPages(refreshToken: string, siteUrl: string): Promise<string[]> {
  return (await listPagePerformance(refreshToken, siteUrl)).map((page) => page.url);
}

const GOOGLE_API_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Thrown specifically when Google rejects the refresh token itself (Google's
 * `invalid_grant` — expired, revoked, or malformed) — the one case where the
 * customer's own reconnect action can actually fix things.
 */
export class GoogleAuthError extends Error {}

/**
 * Thrown when Google rejects Dex's own OAuth client credentials
 * (`invalid_client`, `unauthorized_client`) rather than the customer's
 * token. Per Google's OAuth2 token-endpoint error reference, both are
 * raised while authenticating the (client_id, client_secret) pair, before
 * the refresh_token grant is ever evaluated — so they say nothing about
 * whether the customer's token is good, and a customer reconnecting cannot
 * actually fix the underlying cause.
 *
 * Connect-time callers (gsc/callback, gsc/select-site routes) still never touch the stored
 * token or `gscReconnectRequired` for this — the customer is live in the flow and gets told
 * the specific, accurate cause directly in the response. run-scan.ts's unattended background
 * scan is the one exception: it has no other channel to the customer than the Settings badge,
 * so it flags `gscReconnectRequired` for this too, accepting an imprecise "Reconnect" CTA as
 * the lesser trust violation than a badge that stays green through a real, ongoing failure.
 */
export class GoogleConfigError extends Error {}

export function classifyGoogleFailure(err: unknown): 'token' | 'config' | 'unknown' {
  const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  if (code === 'invalid_grant') return 'token';
  if (code === 'invalid_client' || code === 'unauthorized_client') return 'config';
  // A bare 401 with no recognized error code, or anything else, is left
  // unclassified — callers treat this as transient/unknown and leave
  // stored credentials untouched rather than guessing.
  return 'unknown';
}

export async function listVerifiedSites(refreshToken: string): Promise<string[]> {
  const auth = client();
  auth.setCredentials({ refresh_token: refreshToken });

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  let data;
  try {
    ({ data } = await withTimeout(searchconsole.sites.list(), GOOGLE_API_TIMEOUT_MS, 'Google Search Console sites.list'));
  } catch (err) {
    const kind = classifyGoogleFailure(err);
    if (kind === 'token') throw new GoogleAuthError('Google rejected this Search Console connection');
    if (kind === 'config') throw new GoogleConfigError("Dex's Google OAuth client configuration was rejected");
    throw err;
  }

  return (data.siteEntry ?? [])
    .filter((site) => site.permissionLevel && site.permissionLevel !== 'siteUnverifiedUser')
    .map((site) => site.siteUrl)
    .filter((url): url is string => Boolean(url));
}

export async function fetchSitemapUrls(websiteUrl: string, fetchImpl: typeof fetch = defaultFetch): Promise<string[]> {
  try {
    const siteHostname = new URL(websiteUrl).hostname;
    const sitemapUrl = new URL('/sitemap.xml', websiteUrl).toString();
    const res = await fetchImpl(sitemapUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const matches = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)];
    // A compromised or malicious sitemap.xml can otherwise smuggle arbitrary off-site targets
    // (including private-network addresses) into the crawl queue via <loc> entries — restrict
    // to the audited site's own hostname, same as extractInternalLinks already does for HTML links.
    return matches
      .map((m) => m[1])
      .filter((url): url is string => Boolean(url))
      .filter((url) => {
        try {
          return new URL(url).hostname === siteHostname;
        } catch {
          return false;
        }
      })
      // A sitemap index lists OTHER sitemap files (page-sitemap.xml, post-sitemap.xml, ...) as
      // <loc> entries using this exact tag -- excluded here so an index's sub-sitemap URLs never
      // get treated as real pages downstream. See isSitemapUrl's doc comment for the full story.
      .filter((url) => !isSitemapUrl(url));
  } catch {
    return [];
  }
}

export function mergeSitemapUrls(performance: PagePerformance[], sitemapUrls: string[]): PagePerformance[] {
  const existingUrls = new Set(performance.map((page) => page.url));
  const supplemental = sitemapUrls
    .filter((url) => !existingUrls.has(url))
    .map((url) => ({ url, impressions: 0, clicks: 0, ctr: 0 }));
  return [...performance, ...supplemental];
}

export function findPagePerformance(performance: PagePerformance[], pageUrl: string): { impressions: number; clicks: number; ctr: number } {
  const match = performance.find((page) => page.url === pageUrl);
  return match ? { impressions: match.impressions, clicks: match.clicks, ctr: match.ctr } : { impressions: 0, clicks: 0, ctr: 0 };
}

export function findObservedPagePerformance(performance: PagePerformance[], pageUrl: string): { impressions: number; clicks: number; ctr: number } | null {
  const match = performance.find((page) => page.url === pageUrl);
  return match ? { impressions: match.impressions, clicks: match.clicks, ctr: match.ctr } : null;
}
