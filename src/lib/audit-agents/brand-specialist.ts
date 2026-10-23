import * as cheerio from 'cheerio';
import type { FindingSeverity } from '@prisma/client';
import { CLAIM_PATTERNS } from '@/lib/claim-patterns';

// Brief section 5's required evidence schema, same shape as seo-specialist.ts/geo-specialist.ts.
export interface BrandFindingInput {
  ruleId: string;
  severity: FindingSeverity;
  confidence: 'high' | 'medium' | 'low';
  evidence: Record<string, unknown>;
  limitations: string | null;
  suggestedAction: string;
}

// Body text can be arbitrarily long — cap before matching so this runs in bounded time
// regardless of what a crawled page contains (treat crawled content as untrusted data).
const MAX_BODY_CHARS = 20_000;
// One Finding per page, not one per matched claim — a marketing page routinely trips 5+ of the
// 13 patterns in one paragraph ("#1 rated, award-winning, guaranteed, 10,000+ customers…");
// bundling avoids spamming the same page with a dozen near-duplicate rows.
const MAX_MATCHES_PER_FINDING = 10;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

interface ClaimMatch {
  text: string;
  context: string;
}

// Widens from the match outward to the nearest sentence boundary (., !, ?) on each side, capped
// at MAX_CONTEXT_RADIUS — the containing sentence, not an arbitrary character window. A fixed
// radius can bleed across sentence boundaries on short/dense text ("...platform. We are also
// the fastest...") and let one claim's approval-check accidentally match an unrelated adjacent
// claim's approved fact — sentence-bounding is what actually prevents that.
const MAX_CONTEXT_RADIUS = 120;
const SENTENCE_BOUNDARY = /[.!?]/;

function sentenceContext(bodyText: string, index: number, matchLength: number): string {
  let start = index;
  while (start > 0 && index - start < MAX_CONTEXT_RADIUS && !SENTENCE_BOUNDARY.test(bodyText[start - 1])) start--;
  let end = index + matchLength;
  while (end < bodyText.length && end - (index + matchLength) < MAX_CONTEXT_RADIUS && !SENTENCE_BOUNDARY.test(bodyText[end])) end++;
  return bodyText.slice(start, end).replace(/\s+/g, ' ').trim();
}

// Extracts claim-shaped phrases from a page's visible body text. Uses the same pattern family
// proof-layer.ts validates drafts against (src/lib/claim-patterns.ts), imported independently —
// not re-exported from proof-layer — so a precision change for draft validation (short
// title+meta strings, high stakes since it gates publishing) never silently reshapes what this
// audit check flags on a customer's full page prose, or vice versa.
export function extractCandidateClaims(html: string): ClaimMatch[] {
  const $ = cheerio.load(html);
  const bodyText = $('body').text().slice(0, MAX_BODY_CHARS);
  const matches: ClaimMatch[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    const match = bodyText.match(pattern);
    if (!match || match.index === undefined) continue;
    matches.push({ text: match[0].trim(), context: sentenceContext(bodyText, match.index, match[0].length) });
  }
  return matches;
}

const MAX_RESTRICTED_MATCHES_PER_FINDING = 10;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A restricted phrase counts as "found" once per phrase, not once per occurrence -- repeated
// appearances of the same configured phrase must not spam multiple findings for one page.
// Word-boundary-aware (Unicode-letter/number aware, so ä/ö/ü count as letters like any other)
// to avoid a naive-substring false positive: a configured phrase "free" must not match inside
// "carefree" unless the customer's own preference is stored as a substring match.
export function checkRestrictedWording(pageUrl: string, html: string, restrictedWording: string[]): BrandFindingInput[] {
  if (restrictedWording.length === 0) return [];

  const $ = cheerio.load(html);
  $('script, style').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_CHARS);

  const matches: { phrase: string; excerpt: string }[] = [];
  for (const raw of restrictedWording) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'iu');
    const match = pattern.exec(bodyText);
    if (!match || match.index === undefined) continue;
    matches.push({ phrase, excerpt: sentenceContext(bodyText, match.index, match[0].length) });
  }

  if (matches.length === 0) return [];

  const capped = matches.slice(0, MAX_RESTRICTED_MATCHES_PER_FINDING);
  return [
    {
      ruleId: 'restricted_wording_found',
      severity: 'medium',
      confidence: 'high',
      evidence: {
        pageUrl,
        matches: capped.map((m) => ({ phrase: m.phrase, excerpt: m.excerpt })),
        totalFound: matches.length,
      },
      limitations:
        'This is a configured brand-wording preference, not an objective SEO defect or legal issue -- matched exactly as configured, with no stemming, translation, or semantic expansion.',
      suggestedAction:
        matches.length === 1
          ? `Review the restricted phrase "${capped[0].phrase}" on ${pageUrl} and update the copy if it should be avoided.`
          : `Review the ${matches.length} restricted phrases found on ${pageUrl} and update the copy if they should be avoided.`,
    },
  ];
}

// A claim "matches" an approved CustomerFact when the fact's normalized text appears inside the
// claim's normalized context (or vice versa) — a loose substring check, not semantic
// verification, hence 'medium' confidence on the resulting Finding.
function isApproved(match: ClaimMatch, approvedFacts: { claim: string }[]): boolean {
  const normalizedContext = normalize(match.context);
  return approvedFacts.some((fact) => {
    const normalizedClaim = normalize(fact.claim);
    return normalizedClaim.length > 0 && (normalizedContext.includes(normalizedClaim) || normalizedClaim.includes(normalize(match.text)));
  });
}

// One bundled Finding per page listing every unverified claim found, capped — never one row
// per match (see MAX_MATCHES_PER_FINDING above).
export function runBrandSpecialist(input: {
  pageUrl: string;
  html: string;
  approvedFacts: { claim: string; category: string }[];
}): BrandFindingInput[] {
  const candidates = extractCandidateClaims(input.html);
  const unverified = candidates.filter((c) => !isApproved(c, input.approvedFacts));
  if (unverified.length === 0) return [];

  const capped = unverified.slice(0, MAX_MATCHES_PER_FINDING);
  return [
    {
      ruleId: 'unverified_claim_candidate',
      severity: 'medium',
      confidence: 'medium',
      evidence: {
        pageUrl: input.pageUrl,
        matches: capped.map((c) => ({ text: c.text, context: c.context })),
        totalFound: unverified.length,
      },
      limitations:
        'Pattern-matched candidate claims, not semantically verified — may include false positives (e.g. a claim already covered by an approved fact worded differently).',
      suggestedAction:
        unverified.length === 1
          ? `Confirm the claim "${capped[0].text}" on ${input.pageUrl} is accurate, then add it to Customer Facts so future drafts can cite it.`
          : `Confirm the ${unverified.length} unverified claim-shaped phrases on ${input.pageUrl} are accurate, then add the real ones to Customer Facts.`,
    },
  ];
}
