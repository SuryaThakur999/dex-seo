import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { safeFetch } from '@/lib/safe-fetch';
import type { SocialPlatform, SocialProfile } from '@/lib/profile-suggestion-evidence';

const USER_AGENT = 'DexBot/0.1';

// Default fetch path for every real (non-test) call below — routes through the SSRF-safe
// fetch (DNS-validated, redirect-revalidated, response-size-capped; see safe-fetch.ts) rather
// than the raw platform `fetch`. Tests inject their own `fetchImpl` mock explicitly and never
// hit this default, so existing test behavior is unaffected — only production traffic changes.
const defaultFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const result = await safeFetch(String(input), {
    headers: init?.headers as Record<string, string> | undefined,
  });
  return { ok: result.ok, status: result.status, text: result.text } as Response;
}) as typeof fetch;

// Readable body text for Marketing Memory profile-suggestion extraction (Phase 2F S4) — from
// the same fetched HTML the scan already has, never a second fetch. Strips script/style/nav/
// footer noise so the model sees marketing copy, not boilerplate chrome. Capped at the same
// MAX_BODY_CHARS brand-specialist.ts already uses for crawled text (treat as untrusted input).
const MAX_PROFILE_BODY_CHARS = 20_000;

export function extractBodyText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_PROFILE_BODY_CHARS);
}

export function parsePageMeta(html: string): { title: string | null; metaDescription: string | null; h1: string | null } {
  const $ = cheerio.load(html);
  const title = $('head title').first().text().trim() || null;
  const metaDescription = $('meta[name="description" i]').attr('content')?.trim() || null;
  const h1 = $('h1').first().text().trim() || null;
  return { title, metaDescription, h1 };
}

// Dashboard audit: 6 of 11 Review items on one real site were /sign-in and /sign-up pages --
// a customer's own auth/account flow is never a page Dex should be drafting SEO fixes for.
const AUTH_ACCOUNT_PATH_PATTERN = /\/(sign-in|signin|sign-up|signup|log-in|login|account|register|cart|checkout)(\/|$|[?#])/i;

export function isAuthOrAccountPath(url: string): boolean {
  try {
    return AUTH_ACCOUNT_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Respects the site owner's own "don't index this" signal -- a page already excluded from
// search by its own meta tag shouldn't get SEO findings/drafts from Dex either.
export function hasNoindexMeta(html: string): boolean {
  const $ = cheerio.load(html);
  const content = $('meta[name="robots" i]').attr('content') ?? '';
  return content
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .includes('noindex');
}

// SEO Specialist signals (brief section 5: "Canonicals... relevant structured data") — parsed
// from the same fetched HTML the scan already has, never a second fetch per the brief's
// "use shared crawl evidence" requirement.
export interface SeoSignals {
  canonicalUrl: string | null;
  hasStructuredData: boolean;
  internalLinkCount: number;
}

export function parseSeoSignals(html: string, pageUrl: string): SeoSignals {
  const $ = cheerio.load(html);
  const canonicalUrl = $('link[rel="canonical" i]').attr('href')?.trim() || null;
  const hasStructuredData = $('script[type="application/ld+json" i]').length > 0;
  const internalLinkCount = extractInternalLinks(html, pageUrl).length;
  return { canonicalUrl, hasStructuredData, internalLinkCount };
}

// GEO / AI Discoverability Specialist signal (brief section 5): parsed from the same fetched
// HTML the scan already has — no second fetch. Checks for JSON-LD entity-type markup
// (Organization/WebSite/Person/LocalBusiness/Corporation), a real, observable, deterministic
// fact — not a guess about actual AI-answer-engine behavior. Distinct from SEO Specialist's
// `hasStructuredData` (which only checks whether ANY JSON-LD exists): a page can have JSON-LD
// for something else entirely (e.g. only Article/Product schema) and still lack the entity
// markup that lets an AI system reliably identify what the site/organization actually is.
const ENTITY_TYPES = new Set(['Organization', 'WebSite', 'Person', 'LocalBusiness', 'Corporation']);

export function hasEntityMarkup(html: string): boolean {
  const $ = cheerio.load(html);
  let found = false;
  $('script[type="application/ld+json" i]').each((_, el) => {
    if (found) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return; // malformed JSON-LD — skip this block, don't fail the whole check
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const type = (item as { '@type'?: unknown })['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((t) => typeof t === 'string' && ENTITY_TYPES.has(t))) {
        found = true;
        return;
      }
    }
  });
  return found;
}

export async function isAllowedByRobots(
  url: string,
  fetchRobotsTxt: (robotsUrl: string) => Promise<string>
): Promise<boolean> {
  const { origin } = new URL(url);
  const robotsUrl = `${origin}/robots.txt`;
  const robotsTxt = await fetchRobotsTxt(robotsUrl).catch(() => '');
  const robots = robotsParser(robotsUrl, robotsTxt);
  return robots.isAllowed(url, USER_AGENT) ?? true;
}

// In-memory only: correct within one scan request's loop over a customer's
// pages (same process), not across separate serverless invocations.
const lastFetchAt = new Map<string, number>();

export async function throttle(hostname: string, minIntervalMs: number): Promise<void> {
  const last = lastFetchAt.get(hostname) ?? 0;
  const wait = Math.max(0, last + minIntervalMs - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastFetchAt.set(hostname, Date.now());
}

// Caches robots.txt per origin (not per-page) so scanning many pages on one
// customer's domain doesn't send an unthrottled robots.txt request per page.
const robotsTxtCache = new Map<string, Promise<string>>();

function cachedFetchRobotsTxt(robotsUrl: string, fetchImpl: typeof fetch): Promise<string> {
  let cached = robotsTxtCache.get(robotsUrl);
  if (!cached) {
    cached = fetchImpl(robotsUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) })
      .then((res) => (res.ok ? res.text() : ''))
      .catch(() => '');
    robotsTxtCache.set(robotsUrl, cached);
  }
  return cached;
}

// Exposes the same per-origin cache `isAllowedByRobots` already populates while checking each
// page — the GEO Specialist's AI-crawler-access check (brief section 5: "use shared crawl
// evidence") reads the site's robots.txt this way instead of fetching it a second time.
export async function fetchRobotsTxtForOrigin(url: string, fetchImpl: typeof fetch = defaultFetch): Promise<string> {
  const { origin } = new URL(url);
  return cachedFetchRobotsTxt(`${origin}/robots.txt`, fetchImpl);
}

export interface FetchHtmlResult {
  html: string | null;
  // Real HTTP status of the final response (after safeFetch's own bounded redirect-following),
  // or null when there is no real status to report -- robots-blocked (never requested) or a
  // network/timeout exception (transport never completed). Never guessed or defaulted to 200.
  status: number | null;
  blockedByRobots: boolean;
}

// Raised by discoverPagesWithoutGsc (run-scan.ts) when a site's own homepage actively refuses
// Dex's scanner (a real 4xx/5xx response or a robots.txt disallow) and no other real pages were
// discoverable either -- confirmed against real production data 2026-09-17 for decathlon.co.uk
// and bershka.com, both returning HTTP 403 to every request. Large/enterprise-tier bot
// protection (Akamai, Cloudflare, PerimeterX) typically fingerprints TLS/behavior, not just
// headers, so this is a real site-side block, not something Dex can reliably work around --
// the honest fix is telling the customer clearly, not a confusing single "broken page" finding.
export class SiteBlockedError extends Error {}

export async function fetchHtmlWithStatus(url: string, fetchImpl: typeof fetch = defaultFetch): Promise<FetchHtmlResult> {
  const { hostname } = new URL(url);

  const allowed = await isAllowedByRobots(url, (robotsUrl) => cachedFetchRobotsTxt(robotsUrl, fetchImpl));
  if (!allowed) return { html: null, status: null, blockedByRobots: true };

  await throttle(hostname, 1000);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { html: null, status: res.status, blockedByRobots: false };
    return { html: await res.text(), status: res.status, blockedByRobots: false };
  } catch {
    // A single page's network failure must not abort the scan loop over the rest of a
    // customer's pages -- and there is genuinely no status code to report here, not a 0 or
    // a guess at which class of failure this was.
    return { html: null, status: null, blockedByRobots: false };
  }
}

export async function fetchHtml(url: string, fetchImpl: typeof fetch = defaultFetch): Promise<string | null> {
  return (await fetchHtmlWithStatus(url, fetchImpl)).html;
}

export async function fetchPageMeta(
  url: string,
  fetchImpl: typeof fetch = defaultFetch
): Promise<{ title: string | null; metaDescription: string | null; h1: string | null }> {
  const html = await fetchHtml(url, fetchImpl);
  if (html === null) return { title: null, metaDescription: null, h1: null };
  return parsePageMeta(html);
}

// A sitemap (or sitemap index) `<loc>` entry is never a page a visitor reads — running the
// HTML-oriented extractors above (parsePageMeta, parseSeoSignals) on an XML response produces
// garbage, not a real page signal (confirmed root cause of a live bug: NanoDiagnostics'
// page-sitemap.xml ending up as an `internal_link_fix` draft target with "site map" repeated
// as the anchor text). A sitemap INDEX file (e.g. WordPress/Yoast's sitemap_index.xml) lists
// OTHER sitemap files as `<loc>` targets using the exact same tag `fetchSitemapUrls`' regex
// sweeps for real page URLs — it doesn't distinguish a `<sitemapindex>` from a `<urlset>` — so
// a sub-sitemap URL like page-sitemap.xml leaks in looking identical to a real page. A site's
// own HTML can also link straight to its sitemap (an SEO plugin's footer "XML Sitemap" link),
// which would otherwise pass through extractInternalLinks the same way. Filtered by extension
// at both of those entry points rather than downstream, so a sitemap URL never reaches
// crawl/draft generation in the first place.
export function isSitemapUrl(url: string): boolean {
  try {
    return /\.xml(\.gz)?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Same-hostname links reachable from one page's HTML — the no-GSC page-discovery
// source (alongside sitemap.xml) for a site with no Search Console connection.
export function extractInternalLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) return;
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
      resolved.hash = '';
      links.add(resolved.toString());
    } catch {
      // malformed or unparseable href (mailto:, javascript:, tel:, etc.) — skip
    }
  });
  return [...links];
}

// Social-profile-discovery plan (2026-10-17): host-match, not footer/header-scoped markup --
// semantic <footer>/<header> tags aren't guaranteed on a real site, but the 7 named platforms'
// hostnames are a reliable signal regardless of where the link sits on the page.
const SOCIAL_HOST_PLATFORM: Record<string, SocialPlatform> = {
  'linkedin.com': 'linkedin', 'www.linkedin.com': 'linkedin',
  'xing.com': 'xing', 'www.xing.com': 'xing',
  'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
  'facebook.com': 'facebook', 'www.facebook.com': 'facebook',
  'x.com': 'x', 'www.x.com': 'x', 'twitter.com': 'x', 'www.twitter.com': 'x',
  'youtube.com': 'youtube', 'www.youtube.com': 'youtube', 'youtu.be': 'youtube',
  'tiktok.com': 'tiktok', 'www.tiktok.com': 'tiktok',
};

function socialPlatformForHost(hostname: string): SocialPlatform | null {
  return SOCIAL_HOST_PLATFORM[hostname] ?? null;
}

function addSocialLink(links: Map<string, SocialProfile>, rawUrl: unknown, baseUrl: string): void {
  if (typeof rawUrl !== 'string') return;
  try {
    const resolved = new URL(rawUrl, baseUrl);
    const platform = socialPlatformForHost(resolved.hostname);
    if (!platform) return;
    resolved.hash = '';
    const url = resolved.toString();
    links.set(`${platform}:${url}`, { platform, url });
  } catch {
    // malformed/unparseable URL — skip
  }
}

export function extractSocialProfileLinks(html: string, baseUrl: string): SocialProfile[] {
  const $ = cheerio.load(html);
  const links = new Map<string, SocialProfile>();

  $('a[href]').each((_, el) => addSocialLink(links, $(el).attr('href'), baseUrl));

  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(el).text());
    } catch {
      return;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const sameAs = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).sameAs : undefined;
      const sameAsList = Array.isArray(sameAs) ? sameAs : typeof sameAs === 'string' ? [sameAs] : [];
      for (const url of sameAsList) addSocialLink(links, url, baseUrl);
    }
  });

  return [...links.values()];
}
