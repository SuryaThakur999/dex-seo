import { createHash } from 'node:crypto';
import type { Customer, Website, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { listPagePerformance, fetchSitemapUrls, mergeSitemapUrls, GoogleAuthError, GoogleConfigError } from '@/lib/gsc-client';
import { fetchHtmlWithStatus, extractInternalLinks, extractSocialProfileLinks, parsePageMeta, parseSeoSignals, hasEntityMarkup, fetchRobotsTxtForOrigin, isSitemapUrl, SiteBlockedError, extractBodyText, isAuthOrAccountPath, hasNoindexMeta } from '@/lib/crawler';
import { normalizePageUrlForRescan, resolvePriorFindingsForPage, resolveUnvisitedFindings } from '@/lib/verified-on-rescan';
import { isProfileEvidencePage, type CrawledProfilePage, type SocialProfile } from '@/lib/profile-suggestion-evidence';
import { extractProfileSuggestions, PROFILE_SUGGESTION_MODEL, PROFILE_SUGGESTION_PROMPT_VERSION } from '@/lib/profile-suggestion-extractor';
import { storeProfileSuggestions } from '@/lib/profile-suggestions';
import { flagPages, type PageSnapshot as GrowthBrainPageSnapshot } from '@/lib/growth-brain';
import { runSeoSpecialist, checkStatusCode } from '@/lib/audit-agents/seo-specialist';
import { runGeoSpecialistForSite, runGeoSpecialistForHomepage } from '@/lib/audit-agents/geo-specialist';
import { runBrandSpecialist, checkRestrictedWording } from '@/lib/audit-agents/brand-specialist';
import {
  CANONICAL_FIX_RULE_IDS,
  CANONICAL_FIX_ACTION_TYPE,
  STRUCTURED_DATA_FIX_RULE_IDS,
  STRUCTURED_DATA_FIX_ACTION_TYPE,
  ENTITY_MARKUP_FIX_RULE_IDS,
  ENTITY_MARKUP_FIX_ACTION_TYPE,
} from '@/lib/deterministic-remediation';
import { RESTRICTED_WORDING_FIX_RULE_IDS, RESTRICTED_WORDING_FIX_ACTION_TYPE } from '@/lib/restricted-wording-fix';
import { INTERNAL_LINK_FIX_RULE_IDS, INTERNAL_LINK_FIX_ACTION_TYPE } from '@/lib/internal-link-fix';
import { enqueueGenerationJob, claimAndRunGenerationJob } from '@/lib/generation-worker';
import {
  canonicalFixFingerprint,
  structuredDataFixFingerprint,
  entityMarkupFixFingerprint,
  metaDescriptionFingerprint,
  restrictedWordingFixFingerprint,
  internalLinkFixFingerprint,
} from '@/lib/generation-payload';

// Raised from 20/10 at the account owner's explicit request, to see full agent behavior on a
// real site. Real ceiling, not arbitrary: /api/scan runs the crawl inline (no async worker) and
// is capped by Vercel's own function timeout (see maxDuration in the route) — at roughly 2-3s
// per page (crawl + draft generation), pushing this much past ~100 pages risks the scan timing
// out mid-run on a 300s function, which would silently truncate results rather than complete.
export const MAX_PAGES_PER_SCAN = 100;
const MAX_DRAFTS_PER_SCAN = 30;
const MAX_PAGE_LINKS_PER_PAGE = 100;
const COOLDOWN_DAYS = 14;
// Reserve slots for sitemap-only (zero-impression) pages so a plain tail-slice doesn't silently
// drop them for any customer whose GSC data alone already fills MAX_PAGES_PER_SCAN — that would
// defeat the whole point of the sitemap supplement (surfacing pages GSC can't see).
const SITEMAP_RESERVE = 5;

export interface ScanResult {
  // How many pages this scan tried to read (bounded by MAX_PAGES_PER_SCAN, auth/account paths
  // already excluded before this count) — the honest denominator for "pagesScanned" below.
  // Their difference is pages whose fetch returned nothing usable (no title/h1/
  // metaDescription) or that the page itself marked noindex, silently skipped, not a
  // fabricated failure.
  pagesAttempted: number;
  pagesScanned: number;
  pagesFlagged: number;
  draftsCreated: number;
  // Actions created by a deterministic-remediation generator (Phase 1F) — no LLM call, no
  // provider cost. Counted separately from draftsCreated (every real LLM-drafted actionType —
  // meta_description and, as of Phase 1F, restricted_wording_fix) so a scan summary never blurs
  // the two different generation methods into one number.
  deterministicActionsCreated: number;
  findingsCreated: number;
  // Phase 2F S4: new ProfileSuggestion rows created this scan, 0 when no eligible evidence page
  // was found or crawled, same honest-zero convention as the counters above it.
  profileSuggestionsCreated: number;
  errors: { url: string; error: string }[];
  // True when the scan stopped early because /api/scan/[jobId]/cancel was called mid-run --
  // every count above reflects real work actually completed before the stop, not a fabricated
  // "as if it had finished" total.
  cancelled: boolean;
}

// Hashes exactly the fields a fresh draft would be grounded in. If none of them changed
// since the last time we drafted for this page, a new draft would just recreate what's
// already sitting in the database (approved, edited, or rejected) — skip it regardless of
// that prior decision. This closes a gap the 14-day cooldown doesn't: cooldown only protects
// approved/edited actions, so a rejected page was getting re-drafted (and re-billed) on
// every single scan forever.
function computeContentHash(page: { title: string | null; metaDescription: string | null; h1: string | null }): string {
  const stable = JSON.stringify({ title: page.title, metaDescription: page.metaDescription, h1: page.h1 });
  return createHash('sha256').update(stable).digest('hex');
}

async function logStep(scanJobId: string | undefined, message: string): Promise<void> {
  if (!scanJobId) return;
  await db.scanLogLine.create({ data: { scanJobId, message } });
}

// /api/scan/[jobId]/cancel runs in a separate serverless invocation from the inline scan
// loop below -- the DB row is the only channel between them. Checked once per page/draft
// rather than continuously, so a cancel takes effect within one page's worth of latency,
// not instantly, but never leaves a scan silently un-cancellable.
async function isCancelled(scanJobId: string | undefined): Promise<boolean> {
  if (!scanJobId) return false;
  const job = await db.scanJob.findUnique({ where: { id: scanJobId }, select: { cancelRequested: true } });
  return job?.cancelRequested ?? false;
}

// Page-discovery source for a site with no resolved GSC connection: the
// homepage's own internal links plus its sitemap.xml, deduped and capped at
// the same budget the GSC path uses. impressions/clicks/ctr are 0 — "no
// search-performance data available," matching the existing convention for
// sitemap-only entries in the GSC path below.
async function discoverPagesWithoutGsc(website: Website): Promise<{ url: string; impressions: number; clicks: number; ctr: number }[]> {
  const [homepage, sitemapUrls] = await Promise.all([
    fetchHtmlWithStatus(website.url),
    fetchSitemapUrls(website.url),
  ]);
  const internalLinks = homepage.html ? extractInternalLinks(homepage.html, website.url) : [];
  // fetchSitemapUrls already excludes sitemap/.xml entries at its own source, but a site's HTML
  // can link straight to its own sitemap too (an SEO plugin's footer "XML Sitemap" link) --
  // extractInternalLinks has no reason to know that's not a real page, so the exclusion is
  // re-applied here, at the actual choke point every discovery source feeds into.
  const discovered = [...new Set([website.url, ...internalLinks, ...sitemapUrls])]
    .filter((url) => !isSitemapUrl(url))
    .slice(0, MAX_PAGES_PER_SCAN);

  // The homepage itself actively refused Dex (a real 4xx/5xx, or robots.txt disallow) and
  // nothing else was discoverable either (no internal links to extract, no sitemap URLs) --
  // the scan is about to "complete" having covered only the one page that will fail again.
  // Surface that honestly instead of letting it look like a generic broken-page finding.
  const homepageBlocked = homepage.blockedByRobots || (homepage.status !== null && homepage.status >= 400);
  if (homepageBlocked && discovered.length <= 1) {
    const reason = homepage.blockedByRobots
      ? `${website.url}'s robots.txt disallows Dex from reading it`
      : `${website.url} returned HTTP ${homepage.status} when Dex tried to read it`;
    throw new SiteBlockedError(
      `${reason}. This usually means the site's bot protection is blocking automated scanners -- a known limitation on some large or heavily-protected sites, not a bug in Dex.`
    );
  }

  return discovered.map((url) => ({ url, impressions: 0, clicks: 0, ctr: 0 }));
}

export async function runScanForCustomer(customer: Customer, website: Website, scanJobId?: string): Promise<ScanResult> {
  const hasResolvedGsc = Boolean(website.gscRefreshToken) && !website.gscReconnectRequired && Boolean(website.gscPropertyUrl);

  let performance: { url: string; impressions: number; clicks: number; ctr: number }[];
  if (hasResolvedGsc) {
    const refreshToken = decrypt(website.gscRefreshToken!);
    let gscPerformance, sitemapUrls;
    try {
      [gscPerformance, sitemapUrls] = await Promise.all([
        listPagePerformance(refreshToken, website.gscPropertyUrl!),
        fetchSitemapUrls(website.url),
      ]);
    } catch (err) {
      // GoogleConfigError (Dex's own OAuth client credentials rejected) is deliberately NOT
      // flagged this way at connect-time (gsc/callback, gsc/select-site) -- those happen while
      // the customer is actively in the flow and can be told the real, specific cause right
      // there ("configuration issue on our end"), so there's no reason to also mislabel it as
      // theirs to fix. A scan failure has no such channel: it runs unattended, and the ONLY
      // customer-visible signal of "something is wrong with this site's GSC connection" is this
      // same Settings badge. Confirmed live 2026-10-01: example.com showed calm green "Search
      // Console connected" through 17 consecutive days of this exact GoogleConfigError, because
      // the badge only reacts to GoogleAuthError. A badge that says "connected" through 17 days
      // of identical failure is a worse trust violation than one whose "Reconnect" CTA doesn't
      // literally fix a Dex-side problem -- so both error classes flip this flag here, and the
      // reconnect-required copy below is now worded to stay accurate for either cause.
      if (err instanceof GoogleAuthError || err instanceof GoogleConfigError) {
        // Anchor on the exact ciphertext that failed, not just the row id: if the
        // customer reconnected while this call was in flight, the row now holds a
        // fresh token and this stale write must no-op rather than overwrite their
        // just-completed success with a false "reconnect needed".
        try {
          await db.website.updateMany({
            where: { id: website.id, gscRefreshToken: website.gscRefreshToken },
            data: { gscReconnectRequired: true },
          });
        } catch (flagErr) {
          console.error(`run-scan: failed to flag reconnect-required for website ${website.id}`, flagErr instanceof Error ? flagErr.message : flagErr);
        }
      }
      throw err;
    }
    // mergeSitemapUrls always appends sitemap-only entries after every GSC entry (see its
    // implementation), so slicing its unsliced output at the gscPerformance boundary reliably
    // separates the two parts below. Reserve up to SITEMAP_RESERVE slots for sitemap-only pages,
    // but backfill any slots it doesn't use back to GSC pages instead of leaving them empty.
    const merged = mergeSitemapUrls(gscPerformance, sitemapUrls);
    const supplemental = merged.slice(gscPerformance.length);
    const sitemapTaken = supplemental.slice(0, SITEMAP_RESERVE);
    const gscBudget = MAX_PAGES_PER_SCAN - sitemapTaken.length;
    performance = [...gscPerformance.slice(0, gscBudget), ...sitemapTaken];
  } else {
    performance = await discoverPagesWithoutGsc(website);
  }
  // Applied once both discovery sources have converged -- GSC performance data and sitemap
  // discovery can both surface a customer's own sign-in/account/cart pages, which are never a
  // page Dex should be drafting SEO fixes for.
  performance = performance.filter((page) => !isAuthOrAccountPath(page.url));
  // Page-identity fix (overseer, 2026-10-17, live on Yoki): the bare domain and '/' are the
  // same page but GSC/sitemap/internal-link discovery can surface both as distinct strings --
  // collapsed here, at the one place both discovery paths converge before the per-page loop,
  // so only one Finding row is ever created for that page going forward (not just deduped at
  // verified-on-rescan's matching stage, which only cleans up findings already in the DB).
  const seenPageIdentities = new Set<string>();
  performance = performance.filter((page) => {
    const identity = normalizePageUrlForRescan(page.url);
    if (seenPageIdentities.has(identity)) return false;
    seenPageIdentities.add(identity);
    return true;
  });

  const approvedFactRows = await db.customerFact.findMany({
    where: { customerId: customer.id },
    select: { claim: true, category: true },
  });
  const approvedFacts = approvedFactRows.map((f) => f.claim);
  // Fetched here so restricted-wording enforcement applies consistently to every draft this
  // scan produces, not only Content Studio's separate generation path.
  const clientProfile = await db.clientProfile.findUnique({
    where: { id: website.clientProfileId },
    select: { restrictedWording: true, name: true },
  });

  await logStep(scanJobId, `Found ${performance.length} pages to check.`);

  // Site-level GEO check (brief section 5): robots.txt is fetched once per origin and reused
  // from the same cache isAllowedByRobots already populates per-page below — never a second
  // fetch. This is a site-wide fact (which named AI crawlers this robots.txt blocks), so it
  // creates at most one finding per scan, not one per page.
  const robotsTxt = await fetchRobotsTxtForOrigin(website.url);
  const geoSiteFindings = runGeoSpecialistForSite({ siteUrl: website.url, robotsTxt });
  let geoFindingsCreated = 0;
  if (geoSiteFindings.length > 0) {
    await db.finding.createMany({
      data: geoSiteFindings.map((f) => ({
        customerId: customer.id,
        websiteId: website.id,
        scanJobId: scanJobId ?? null,
        pageUrl: website.url,
        agent: 'geo_specialist',
        ruleId: f.ruleId,
        ruleVersion: 'v1',
        severity: f.severity,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonValue,
        limitations: f.limitations,
        suggestedAction: f.suggestedAction,
        retrievedAt: new Date(),
      })),
    });
    geoFindingsCreated += geoSiteFindings.length;
  }

  const snapshots: GrowthBrainPageSnapshot[] = [];
  let findingsCreated = 0;
  let brandFindingsCreated = 0;
  let deterministicActionsCreated = 0;
  // Hoisted here (was previously declared just above the flagged-page draft loop) so the
  // restricted_wording_fix block below -- an LLM draft, same kind of thing as meta_description,
  // just triggered by a different finding -- can share one real count instead of a second,
  // confusingly-named counter for what's conceptually the same "LLM drafts created" number.
  let draftsCreated = 0;
  const errors: { url: string; error: string }[] = [];
  // zero_internal_links needs candidate source pages from the site's OWN full page inventory --
  // only completely known once the main loop below finishes (see the second loop after it, which
  // reuses `snapshots`). Collected here rather than re-derived, so the fix for page N can't
  // accidentally consider a page discovered after N differently from one discovered before it.
  const zeroInternalLinksTargets: { pageUrl: string; title: string | null; findingId: string | null }[] = [];
  let cancelled = false;
  // Phase 2F S4: home/about/product/pricing pages, text only, from the same fetched HTML the
  // loop below already has -- no second crawl. Capped so one scan can't fan a huge site's page
  // count into an oversized extraction call; extractProfileSuggestions caps further to 5 anyway.
  const MAX_PROFILE_EVIDENCE_PAGES = 5;
  const profileEvidencePages: CrawledProfilePage[] = [];
  // Social-profile-discovery plan (2026-10-17): same evidence-page gate as above (home/about/
  // product/pricing), but needs the raw HTML -- not extractBodyText's stripped text -- since a
  // social link's excerpt (the href URL itself) must appear verbatim in whatever page text
  // validateSuggestionEvidence checks it against, and footer/nav markup is stripped from body text.
  const discoveredSocialLinks = new Map<string, SocialProfile>();
  const socialLinkRawPages: CrawledProfilePage[] = [];
  // First page that actually yielded a link, paired with one of ITS links -- guarantees the
  // sourceExcerpt (that link's URL) really appears verbatim in sourceUrl's raw HTML, rather than
  // picking a link discovered on a different page than the one cited as the source.
  let firstSocialLinkSource: { pageUrl: string; linkUrl: string } | null = null;
  let profileSuggestionsCreated = 0;
  // Verified-on-rescan (docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md): every
  // page this scan actually reached, regardless of outcome -- a page NOT in this set at the end
  // of the loop gets its open findings marked could_not_verify by resolveUnvisitedFindings below.
  const visitedNormalizedPageUrls = new Set<string>();
  for (const page of performance) {
    if (await isCancelled(scanJobId)) {
      await logStep(scanJobId, 'Cancelled by user.');
      cancelled = true;
      break;
    }
    visitedNormalizedPageUrls.add(normalizePageUrlForRescan(page.url));
    await logStep(scanJobId, `Checking ${page.url}...`);
    // Fetched once and reused for both the meta signals below and the SEO Specialist's
    // signals (brief section 5: "use shared crawl evidence; do not crawl the same pages
    // separately for every agent").
    const { html, status, blockedByRobots } = await fetchHtmlWithStatus(page.url);

    if (status !== null && status >= 400) {
      const statusFindings = checkStatusCode(page.url, status);
      await db.finding.createMany({
        data: statusFindings.map((f) => ({
          customerId: customer.id,
          websiteId: website.id,
          scanJobId: scanJobId ?? null,
          pageUrl: page.url,
          agent: 'seo_specialist',
          ruleId: f.ruleId,
          ruleVersion: 'v1',
          severity: f.severity,
          confidence: f.confidence,
          evidence: f.evidence as Prisma.InputJsonValue,
          limitations: f.limitations,
          suggestedAction: f.suggestedAction,
          retrievedAt: new Date(),
        })),
      });
      findingsCreated += statusFindings.length;
    }

    if (html === null) {
      if (scanJobId) {
        await resolvePriorFindingsForPage({
          websiteId: website.id, customerId: customer.id, scanJobId, pageUrl: page.url, agent: 'seo_specialist',
          firedRuleIds: new Set(), httpStatus: status, blockedByRobots, noindex: false,
          evidenceForFixed: () => ({}),
        });
      }
      continue;
    }
    // The site owner's own "don't index this" signal -- a page already excluded from search
    // shouldn't get SEO findings/drafts from Dex either. Skipped the same way a failed fetch
    // is: not counted into pagesScanned, honest about what was actually checked.
    if (hasNoindexMeta(html)) {
      await logStep(scanJobId, `Skipping ${page.url} (noindex).`);
      if (scanJobId) {
        await resolvePriorFindingsForPage({
          websiteId: website.id, customerId: customer.id, scanJobId, pageUrl: page.url, agent: 'seo_specialist',
          firedRuleIds: new Set(), httpStatus: status, blockedByRobots: false, noindex: true,
          evidenceForFixed: () => ({}),
        });
      }
      continue;
    }
    if (profileEvidencePages.length < MAX_PROFILE_EVIDENCE_PAGES && isProfileEvidencePage(page.url, website.url)) {
      profileEvidencePages.push({ url: page.url, text: extractBodyText(html) });
      const socialLinksOnPage = extractSocialProfileLinks(html, page.url);
      if (socialLinksOnPage.length > 0) {
        socialLinkRawPages.push({ url: page.url, text: html });
        if (!firstSocialLinkSource) firstSocialLinkSource = { pageUrl: page.url, linkUrl: socialLinksOnPage[0].url };
        for (const link of socialLinksOnPage) discoveredSocialLinks.set(`${link.platform}:${link.url}`, link);
      }
    }
    const meta = parsePageMeta(html);

    // Live Site Graph prerequisite: real internal-link edges from this page, derived from the
    // same fetched HTML the SEO Specialist already reads below -- never a second crawl. Capped
    // per page for the same reason MAX_MATCHES_PER_FINDING caps brand-specialist matches: a
    // single page can legitimately contain hundreds of links, and this is a graph edge list,
    // not a per-link finding that needs every last one.
    const pageLinkTargets = extractInternalLinks(html, page.url).slice(0, MAX_PAGE_LINKS_PER_PAGE);
    if (pageLinkTargets.length > 0) {
      await db.pageLink.createMany({
        data: pageLinkTargets.map((toUrl) => ({
          websiteId: website.id,
          scanJobId: scanJobId ?? null,
          fromUrl: page.url,
          toUrl,
        })),
      });
    }

    const retrievedAt = new Date();
    const seoSignals = parseSeoSignals(html, page.url);
    const seoFindings = runSeoSpecialist({ pageUrl: page.url, signals: seoSignals });
    // Individual creates (not createMany) -- canonical_fix/structured_data_fix/internal_link_fix
    // below need the real Finding.id back to link ActionProvenance (createMany doesn't return
    // created rows). See docs/superpowers/plans/2026-10-12-action-provenance-producer-wiring-note.md.
    const createdSeoFindings = seoFindings.length > 0
      ? await Promise.all(
          seoFindings.map((f) =>
            db.finding.create({
              data: {
                customerId: customer.id,
                websiteId: website.id,
                scanJobId: scanJobId ?? null,
                pageUrl: page.url,
                agent: 'seo_specialist',
                ruleId: f.ruleId,
                ruleVersion: 'v1',
                severity: f.severity,
                confidence: f.confidence,
                evidence: f.evidence as Prisma.InputJsonValue,
                limitations: f.limitations,
                suggestedAction: f.suggestedAction,
                retrievedAt,
              },
            })
          )
        )
      : [];
    findingsCreated += seoFindings.length;
    if (scanJobId) {
      const firedRuleIds = new Set(seoFindings.map((f) => f.ruleId));
      await resolvePriorFindingsForPage({
        websiteId: website.id, customerId: customer.id, scanJobId, pageUrl: page.url, agent: 'seo_specialist',
        firedRuleIds, httpStatus: status, blockedByRobots: false, noindex: false,
        evidenceForFixed: () => ({ note: 'rule no longer fires', checkedAt: retrievedAt.toISOString() }),
      });
    }
    const findingIdForRuleIds = (ruleIds: readonly string[]): string | null =>
      createdSeoFindings.find((f) => (ruleIds as readonly string[]).includes(f.ruleId))?.id ?? null;

    if (seoFindings.some((f) => (INTERNAL_LINK_FIX_RULE_IDS as readonly string[]).includes(f.ruleId))) {
      zeroInternalLinksTargets.push({ pageUrl: page.url, title: meta.title, findingId: findingIdForRuleIds(INTERNAL_LINK_FIX_RULE_IDS) });
    }

    // Phase 1F deterministic remediation: missing_canonical/invalid_canonical always resolve to
    // the same fix (a self-referencing canonical tag), so no LLM call, no ProofLayer -- see
    // deterministic-remediation.ts. Content can never differ for a given pageUrl, so once a
    // canonical_fix Action exists for this page (any status, including a past rejection) there
    // is nothing new to offer; re-litigating a customer's past "no" every scan would be noise,
    // not a real update.
    if (seoFindings.some((f) => (CANONICAL_FIX_RULE_IDS as readonly string[]).includes(f.ruleId))) {
      const existingCanonicalFix = await db.action.findFirst({
        where: { websiteId: website.id, pageUrl: page.url, actionType: CANONICAL_FIX_ACTION_TYPE },
      });
      if (!existingCanonicalFix) {
        try {
          const { id: canonicalJobId } = await enqueueGenerationJob({
            customerId: customer.id,
            websiteId: website.id,
            actionType: CANONICAL_FIX_ACTION_TYPE,
            targetRef: page.url,
            inputFingerprint: canonicalFixFingerprint(page.url),
            payload: {
              actionType: 'canonical_fix',
              pageUrl: page.url,
              currentCanonical: seoSignals.canonicalUrl,
              findingId: findingIdForRuleIds(CANONICAL_FIX_RULE_IDS),
            },
          });
          const canonicalResult = await claimAndRunGenerationJob(canonicalJobId);
          if (canonicalResult.outcome === 'completed') {
            deterministicActionsCreated += 1;
          }
        } catch (err) {
          // Isolate one page's enqueue/claim failure (a DB hiccup, not a generation failure --
          // claimAndRunGenerationJob already catches real generation errors internally and
          // never throws for those) from the rest of the scan, same as every other block below.
          console.error('Canonical-fix enqueue/claim failed for', page.url, err);
          errors.push({ url: page.url, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
    }

    // Phase 1F deterministic remediation: missing_structured_data gets a minimal, honest WebPage
    // JSON-LD block (real page title if one exists, never invented). Same "any status blocks
    // re-creation" dedup as canonical_fix -- a known simplification, not a hidden gap: unlike
    // canonical_fix, this content COULD legitimately change if the customer edits their page
    // title later, and this first version doesn't re-generate on that drift. Tracked, not silent
    // (see docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md).
    if (seoFindings.some((f) => (STRUCTURED_DATA_FIX_RULE_IDS as readonly string[]).includes(f.ruleId))) {
      const existingStructuredDataFix = await db.action.findFirst({
        where: { websiteId: website.id, pageUrl: page.url, actionType: STRUCTURED_DATA_FIX_ACTION_TYPE },
      });
      if (!existingStructuredDataFix) {
        try {
          const { id: structuredDataJobId } = await enqueueGenerationJob({
            customerId: customer.id,
            websiteId: website.id,
            actionType: STRUCTURED_DATA_FIX_ACTION_TYPE,
            targetRef: page.url,
            inputFingerprint: structuredDataFixFingerprint(meta.title),
            payload: {
              actionType: 'structured_data_fix',
              pageUrl: page.url,
              title: meta.title,
              findingId: findingIdForRuleIds(STRUCTURED_DATA_FIX_RULE_IDS),
            },
          });
          const structuredDataResult = await claimAndRunGenerationJob(structuredDataJobId);
          if (structuredDataResult.outcome === 'completed') {
            deterministicActionsCreated += 1;
          }
        } catch (err) {
          console.error('Structured-data-fix enqueue/claim failed for', page.url, err);
          errors.push({ url: page.url, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
    }

    // Brand and Content Specialist (brief section 5): candidate claims scanned from the same
    // fetched html, checked against the customer's approved CustomerFact rows. One bundled
    // Finding per page (not one per matched phrase) — see brand-specialist.ts. Restricted
    // wording reuses the exact same tenant-scoped clientProfile.restrictedWording ProofLayer
    // already reads for draft validation below -- no second preference store, no unscoped query.
    const brandFindings = [
      ...runBrandSpecialist({ pageUrl: page.url, html, approvedFacts: approvedFactRows }),
      ...checkRestrictedWording(page.url, html, clientProfile?.restrictedWording ?? []),
    ];
    // Individual creates (not createMany) -- restricted_wording_fix below needs the real
    // Finding.id back to link ActionProvenance.
    const createdBrandFindings = brandFindings.length > 0
      ? await Promise.all(
          brandFindings.map((f) =>
            db.finding.create({
              data: {
                customerId: customer.id,
                websiteId: website.id,
                scanJobId: scanJobId ?? null,
                pageUrl: page.url,
                agent: 'brand_specialist',
                ruleId: f.ruleId,
                ruleVersion: 'v1',
                severity: f.severity,
                confidence: f.confidence,
                evidence: f.evidence as Prisma.InputJsonValue,
                limitations: f.limitations,
                suggestedAction: f.suggestedAction,
                retrievedAt,
              },
            })
          )
        )
      : [];
    brandFindingsCreated += brandFindings.length;

    // Phase 1F automatically-draftable: restricted_wording_found gets a real LLM rewrite (a
    // mechanical phrase deletion would leave a broken sentence -- this needs judgment, unlike
    // the deterministic-remediation rules above). Same real try/catch lifecycle as
    // meta_description below (a network/LLM call can genuinely fail), reviewed by the existing
    // runProofLayer -- its own no-restricted-wording check is the safety net confirming the
    // rewrite actually removed the flagged phrase(s). Known simplification: unlike canonical_fix
    // (content can never differ), a rejected restricted_wording_fix WILL be redrafted on a later
    // scan while the phrase remains on the page -- no cooldown/content-hash exists for this rule
    // yet, same tradeoff already accepted for structured_data_fix's title-drift case.
    const restrictedWordingFindingId = createdBrandFindings.find((f) =>
      (RESTRICTED_WORDING_FIX_RULE_IDS as readonly string[]).includes(f.ruleId)
    )?.id ?? null;
    const restrictedWordingFinding = brandFindings.find((f) =>
      (RESTRICTED_WORDING_FIX_RULE_IDS as readonly string[]).includes(f.ruleId)
    );
    if (restrictedWordingFinding) {
      const matches = (restrictedWordingFinding.evidence as { matches: { phrase: string; excerpt: string }[] }).matches;
      const alreadyPendingRwf = await db.action.findFirst({
        where: {
          websiteId: website.id,
          pageUrl: page.url,
          actionType: RESTRICTED_WORDING_FIX_ACTION_TYPE,
          status: 'pending',
          generationStatus: 'succeeded',
        },
      });
      if (!alreadyPendingRwf) {
        try {
          const { id: rwfJobId } = await enqueueGenerationJob({
            customerId: customer.id,
            websiteId: website.id,
            actionType: RESTRICTED_WORDING_FIX_ACTION_TYPE,
            targetRef: page.url,
            inputFingerprint: restrictedWordingFixFingerprint(matches),
            payload: {
              actionType: 'restricted_wording_fix',
              pageUrl: page.url,
              matches,
              title: meta.title,
              metaDescription: meta.metaDescription,
              findingId: restrictedWordingFindingId,
            },
          });
          const rwfResult = await claimAndRunGenerationJob(rwfJobId);
          if (rwfResult.outcome === 'completed') {
            draftsCreated += 1;
          } else if (rwfResult.outcome === 'failed') {
            await logStep(scanJobId, `Couldn't draft a restricted-wording fix for ${page.url}.`);
            errors.push({ url: page.url, error: 'Restricted-wording draft failed after retries' });
          } else if (rwfResult.outcome === 'waiting_retry' || rwfResult.outcome === 'rate_limited' || rwfResult.outcome === 'blocked') {
            await logStep(scanJobId, `Drafting a fix for ${page.url}... will retry automatically.`);
          }
        } catch (err) {
          console.error('Restricted-wording-fix enqueue/claim failed for', page.url, err);
          await logStep(scanJobId, `Couldn't draft a restricted-wording fix for ${page.url}.`);
          errors.push({ url: page.url, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
    }

    // Entity/organization identity is a site-level concern, not a per-article one — checked
    // once, on the homepage, using the same fetched `html` (no second fetch).
    if (page.url === website.url) {
      const geoHomepageFindings = runGeoSpecialistForHomepage({ pageUrl: page.url, hasEntityMarkup: hasEntityMarkup(html) });
      // Individual creates (not createMany) -- entity_markup_fix below needs the real
      // Finding.id back to link ActionProvenance.
      const createdGeoHomepageFindings = geoHomepageFindings.length > 0
        ? await Promise.all(
            geoHomepageFindings.map((f) =>
              db.finding.create({
                data: {
                  customerId: customer.id,
                  websiteId: website.id,
                  scanJobId: scanJobId ?? null,
                  pageUrl: page.url,
                  agent: 'geo_specialist',
                  ruleId: f.ruleId,
                  ruleVersion: 'v1',
                  severity: f.severity,
                  confidence: f.confidence,
                  evidence: f.evidence as Prisma.InputJsonValue,
                  limitations: f.limitations,
                  suggestedAction: f.suggestedAction,
                  retrievedAt,
                },
              })
            )
          )
        : [];
      geoFindingsCreated += geoHomepageFindings.length;

      // Phase 1F deterministic remediation: missing_entity_markup gets an Organization JSON-LD
      // block built from the customer's own ClientProfile.name -- the only fact it needs, never
      // invented. Homepage-only, same as the Finding itself, so at most one Action ever exists
      // per site. `clientProfile?.name` guards both a defensive null profile AND an empty-string
      // name (schema requires the field but doesn't enforce non-empty); either way this silently
      // skips the homepage forever with no customer-visible signal that the finding has no
      // remediation path yet -- no live code path creates a blank name today, so left as a
      // known, tracked gap rather than adding unreachable defensive plumbing (independent review
      // finding, 2026-09-26).
      if (geoHomepageFindings.some((f) => (ENTITY_MARKUP_FIX_RULE_IDS as readonly string[]).includes(f.ruleId)) && clientProfile?.name) {
        const existingEntityMarkupFix = await db.action.findFirst({
          where: { websiteId: website.id, pageUrl: page.url, actionType: ENTITY_MARKUP_FIX_ACTION_TYPE },
        });
        if (!existingEntityMarkupFix) {
          try {
            const { id: entityMarkupJobId } = await enqueueGenerationJob({
              customerId: customer.id,
              websiteId: website.id,
              actionType: ENTITY_MARKUP_FIX_ACTION_TYPE,
              targetRef: page.url,
              inputFingerprint: entityMarkupFixFingerprint(clientProfile.name),
              payload: {
                actionType: 'entity_markup_fix',
                pageUrl: page.url,
                findingId: createdGeoHomepageFindings.find((f) => (ENTITY_MARKUP_FIX_RULE_IDS as readonly string[]).includes(f.ruleId))?.id ?? null,
              },
            });
            const entityMarkupResult = await claimAndRunGenerationJob(entityMarkupJobId);
            if (entityMarkupResult.outcome === 'completed') {
              deterministicActionsCreated += 1;
            }
          } catch (err) {
            console.error('Entity-markup-fix enqueue/claim failed for', page.url, err);
            errors.push({ url: page.url, error: err instanceof Error ? err.message : 'Unknown error' });
          }
        }
      }
    }

    if (!meta.title && !meta.h1 && !meta.metaDescription) {
      continue;
    }
    snapshots.push({ ...page, ...meta });
  }
  if (scanJobId) {
    await resolveUnvisitedFindings({ websiteId: website.id, scanJobId, visitedNormalizedPageUrls });
  }
  if (findingsCreated > 0) {
    await logStep(scanJobId, `SEO Specialist recorded ${findingsCreated} finding(s).`);
  }
  if (geoFindingsCreated > 0) {
    await logStep(scanJobId, `GEO Specialist recorded ${geoFindingsCreated} finding(s).`);
  }
  if (brandFindingsCreated > 0) {
    await logStep(scanJobId, `Brand Specialist recorded ${brandFindingsCreated} finding(s).`);
  }
  if (deterministicActionsCreated > 0) {
    await logStep(scanJobId, `Generated ${deterministicActionsCreated} deterministic fix(es), no AI involved.`);
  }

  // Phase 1F automatically-draftable: zero_internal_links needs the site's FULL page inventory
  // to suggest real candidate source pages -- only complete now that the main loop above has
  // finished (snapshots). Same real try/catch/retry lifecycle as meta_description/
  // restricted_wording_fix (a real LLM call, real failure mode). Capped at MAX_DRAFTS_PER_SCAN,
  // same ceiling the meta_description path uses, so a site with many orphan pages can't balloon
  // LLM cost in one scan.
  if (zeroInternalLinksTargets.length > 0) {
    const candidatePages = snapshots.map((s) => ({ url: s.url, title: s.title }));
    for (const target of zeroInternalLinksTargets.slice(0, MAX_DRAFTS_PER_SCAN)) {
      if (!cancelled && (await isCancelled(scanJobId))) {
        await logStep(scanJobId, 'Cancelled by user.');
        cancelled = true;
      }
      if (cancelled) break;

      const candidates = candidatePages.filter((c) => c.url !== target.pageUrl);
      if (candidates.length === 0) continue; // no other real pages exist on this site to suggest

      const alreadyPendingIlf = await db.action.findFirst({
        where: {
          websiteId: website.id,
          pageUrl: target.pageUrl,
          actionType: INTERNAL_LINK_FIX_ACTION_TYPE,
          status: 'pending',
          generationStatus: 'succeeded',
        },
      });
      if (alreadyPendingIlf) continue;

      try {
        const { id: ilfJobId } = await enqueueGenerationJob({
          customerId: customer.id,
          websiteId: website.id,
          actionType: INTERNAL_LINK_FIX_ACTION_TYPE,
          targetRef: target.pageUrl,
          inputFingerprint: internalLinkFixFingerprint(candidates),
          payload: {
            actionType: 'internal_link_fix',
            targetUrl: target.pageUrl,
            targetTitle: target.title,
            candidates,
            findingId: target.findingId,
          },
        });
        const ilfResult = await claimAndRunGenerationJob(ilfJobId);
        if (ilfResult.outcome === 'completed') {
          draftsCreated += 1;
        } else if (ilfResult.outcome === 'failed') {
          await logStep(scanJobId, `Couldn't draft an internal-link fix for ${target.pageUrl}.`);
          errors.push({ url: target.pageUrl, error: 'Internal-link draft failed after retries' });
        } else if (ilfResult.outcome === 'waiting_retry' || ilfResult.outcome === 'rate_limited' || ilfResult.outcome === 'blocked') {
          await logStep(scanJobId, `Drafting an internal-link fix for ${target.pageUrl}... will retry automatically.`);
        }
      } catch (err) {
        console.error('Internal-link-fix enqueue/claim failed for', target.pageUrl, err);
        await logStep(scanJobId, `Couldn't draft an internal-link fix for ${target.pageUrl}.`);
        errors.push({ url: target.pageUrl, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
  }

  const flagged = flagPages(snapshots).slice(0, MAX_DRAFTS_PER_SCAN);
  await logStep(scanJobId, `Found ${flagged.length} page(s) worth fixing.`);


  for (const page of flagged) {
    if (!cancelled && (await isCancelled(scanJobId))) {
      await logStep(scanJobId, 'Cancelled by user.');
      cancelled = true;
    }
    if (cancelled) break;
    // A pending action with a *succeeded* draft is a real duplicate to skip. A pending action
    // whose draft generation *failed* is not — the finding is real and still needs a draft, so
    // it must stay eligible for this loop to pick back up. Nothing extra to look up for that
    // case here: enqueueGenerationJob's idempotency key is derived from this page's own content
    // (see metaDescriptionFingerprint), so re-enqueueing unchanged content resolves to the same
    // job row generation-worker.ts is already retrying, rather than creating a duplicate.
    const alreadyPending = await db.action.findFirst({
      where: { websiteId: website.id, pageUrl: page.url, status: 'pending', generationStatus: 'succeeded' },
    });
    if (alreadyPending) {
      await logStep(scanJobId, `Skipping ${page.url} (already has a pending draft).`);
      continue;
    }

    const recentlyDecided = await db.action.findFirst({
      where: {
        websiteId: website.id,
        pageUrl: page.url,
        status: { in: ['approved', 'edited'] },
        decidedAt: { gte: new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000) },
      },
    });
    if (recentlyDecided) {
      await logStep(scanJobId, `Skipping ${page.url} (recently reviewed).`);
      continue;
    }

    const contentHash = computeContentHash(page);
    const existingSnapshot = await db.pageSnapshot.findUnique({
      where: { websiteId_pageUrl: { websiteId: website.id, pageUrl: page.url } },
    });
    if (existingSnapshot && existingSnapshot.contentHash === contentHash) {
      await logStep(scanJobId, `Skipping ${page.url} (content unchanged since last check).`);
      continue;
    }

    await logStep(scanJobId, `Drafting a fix for ${page.url}...`);
    try {
      const { id: metaDescJobId } = await enqueueGenerationJob({
        customerId: customer.id,
        websiteId: website.id,
        actionType: 'meta_description',
        targetRef: page.url,
        inputFingerprint: metaDescriptionFingerprint(page),
        payload: { actionType: 'meta_description', url: page.url, title: page.title, metaDescription: page.metaDescription, h1: page.h1, findingId: null },
      });
      const metaDescResult = await claimAndRunGenerationJob(metaDescJobId);

      if (metaDescResult.outcome === 'completed') {
        // Only recorded on success — a page that errors out should still be retried next scan
        // even if its content hasn't changed, since we never actually finished it.
        await db.pageSnapshot.upsert({
          where: { websiteId_pageUrl: { websiteId: website.id, pageUrl: page.url } },
          create: { customerId: customer.id, websiteId: website.id, pageUrl: page.url, contentHash },
          update: { contentHash, capturedAt: new Date() },
        });
        draftsCreated += 1;
      } else if (metaDescResult.outcome === 'failed') {
        await logStep(scanJobId, `Couldn't process ${page.url}.`);
        errors.push({ url: page.url, error: 'Meta-description draft failed after retries' });
      } else if (metaDescResult.outcome === 'waiting_retry' || metaDescResult.outcome === 'rate_limited' || metaDescResult.outcome === 'blocked') {
        await logStep(scanJobId, `Drafting a fix for ${page.url}... will retry automatically.`);
      }
    } catch (err) {
      console.error('Meta-description enqueue/claim failed for', page.url, err);
      await logStep(scanJobId, `Couldn't process ${page.url}.`);
      errors.push({ url: page.url, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  // Phase 2F S4: Marketing Memory suggestions, best-effort. Never fails the scan -- the same
  // "non-blocking by design" choice PreferenceSuggestionCard's client-side check already makes
  // for a related AI side-effect of a scan.
  if (profileEvidencePages.length > 0) {
    try {
      const proposals: unknown[] = await extractProfileSuggestions(profileEvidencePages);
      if (discoveredSocialLinks.size > 0 && firstSocialLinkSource) {
        proposals.push({
          field: 'socialProfiles', value: [...discoveredSocialLinks.values()],
          sourceUrl: firstSocialLinkSource.pageUrl, sourceExcerpt: firstSocialLinkSource.linkUrl,
        });
      }
      const result = await storeProfileSuggestions(
        { customerId: customer.id, clientProfileId: website.clientProfileId, websiteId: website.id },
        proposals, [...profileEvidencePages, ...socialLinkRawPages],
        { modelVersion: PROFILE_SUGGESTION_MODEL, promptVersion: PROFILE_SUGGESTION_PROMPT_VERSION },
      );
      profileSuggestionsCreated = result.count;
    } catch (err) {
      console.error('Profile suggestion extraction failed for', website.url, err);
      await logStep(scanJobId, "Couldn't check for Marketing Memory suggestions this scan.");
    }
  }

  return {
    pagesAttempted: performance.length,
    pagesScanned: snapshots.length,
    pagesFlagged: flagged.length,
    draftsCreated,
    deterministicActionsCreated,
    findingsCreated: findingsCreated + geoFindingsCreated + brandFindingsCreated,
    profileSuggestionsCreated,
    errors,
    cancelled,
  };
}
