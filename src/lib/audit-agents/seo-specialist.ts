import type { FindingSeverity } from '@prisma/client';
import type { SeoSignals } from '@/lib/crawler';

// Brief section 5's required evidence schema: evidence, URL, retrieval timestamp, rule
// version, severity, confidence basis, limitations, suggested action. `agent`/`ruleVersion`
// are filled in by the caller (run-scan) so every rule below only supplies what's specific
// to it.
export interface SeoFindingInput {
  ruleId: string;
  severity: FindingSeverity;
  confidence: 'high' | 'medium' | 'low';
  evidence: Record<string, unknown>;
  limitations: string | null;
  suggestedAction: string;
}

export interface SeoSpecialistInput {
  pageUrl: string;
  signals: SeoSignals;
}

// Pure: operates only on signals already parsed from HTML the scan already fetched (brief's
// "use shared crawl evidence" requirement) — never fetches anything itself. Deliberately does
// not re-check title/meta description/h1 — growth-brain.ts's flagPages already covers those
// signals from the same crawl, and duplicating them here would double-report one observation.
export function runSeoSpecialist(input: SeoSpecialistInput): SeoFindingInput[] {
  const { pageUrl, signals } = input;
  const findings: SeoFindingInput[] = [];

  if (!signals.canonicalUrl) {
    findings.push({
      ruleId: 'missing_canonical',
      severity: 'medium',
      confidence: 'high',
      evidence: { pageUrl, canonicalUrl: null },
      limitations: null,
      suggestedAction: `Add a <link rel="canonical"> tag to ${pageUrl} pointing at its preferred URL.`,
    });
  } else {
    let canonicalMatchesSelf = true;
    try {
      canonicalMatchesSelf = new URL(signals.canonicalUrl, pageUrl).toString() === new URL(pageUrl).toString();
    } catch {
      findings.push({
        ruleId: 'invalid_canonical',
        severity: 'medium',
        confidence: 'high',
        evidence: { pageUrl, canonicalUrl: signals.canonicalUrl },
        limitations: 'Canonical value could not be parsed as a URL.',
        suggestedAction: `Fix the malformed canonical URL on ${pageUrl}.`,
      });
      canonicalMatchesSelf = true; // already reported; don't also flag as self-referencing below
    }
    if (!canonicalMatchesSelf) {
      findings.push({
        ruleId: 'canonical_points_elsewhere',
        severity: 'low',
        confidence: 'medium',
        evidence: { pageUrl, canonicalUrl: signals.canonicalUrl },
        limitations: 'A non-self canonical can be intentional (e.g. a tracked duplicate) — verify before treating as an error.',
        suggestedAction: `Confirm ${pageUrl}'s canonical (${signals.canonicalUrl}) is intentional, or point it at itself.`,
      });
    }
  }

  if (!signals.hasStructuredData) {
    findings.push({
      ruleId: 'missing_structured_data',
      severity: 'low',
      confidence: 'high',
      evidence: { pageUrl, hasStructuredData: false },
      limitations: 'Absence of JSON-LD does not mean the page has no other structured-data format (e.g. microdata) — only JSON-LD is detected.',
      suggestedAction: `Add relevant JSON-LD structured data (e.g. Organization, Article, or Product schema) to ${pageUrl}.`,
    });
  }

  if (signals.internalLinkCount === 0) {
    findings.push({
      ruleId: 'zero_internal_links',
      severity: 'medium',
      confidence: 'high',
      evidence: { pageUrl, internalLinkCount: 0 },
      limitations: 'Links added via client-side JavaScript after initial HTML are not counted.',
      suggestedAction: `Add internal links from ${pageUrl} to other pages on the site so crawlers and users can discover them.`,
    });
  }

  return findings;
}

// Brief section 5 originally deferred this: fetchHtml previously collapsed robots-blocked,
// network failure, and a real non-2xx response into the same null, so no honest status-code
// finding could be built without guessing which one happened. fetchHtmlWithStatus (crawler.ts)
// now keeps them distinct -- this only fires on a real, observed HTTP status, never a guess.
export function checkStatusCode(pageUrl: string, statusCode: number): SeoFindingInput[] {
  if (statusCode < 400) return [];
  const severity: FindingSeverity = statusCode >= 500 ? 'high' : 'medium';
  return [
    {
      ruleId: 'broken_page_status',
      severity,
      confidence: 'high',
      evidence: { pageUrl, statusCode },
      limitations: 'Reflects the final response after following redirects — a working page reached via a broken intermediate redirect would not be flagged here.',
      suggestedAction: `${pageUrl} returned HTTP ${statusCode}. Fix the page, or redirect/remove links pointing to it.`,
    },
  ];
}
