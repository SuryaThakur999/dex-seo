import type { ProofOutcome } from '@prisma/client';

// Phase 1F (docs/superpowers/specs/2026-09-25-phase1f-finding-to-action-coverage-design.md):
// "Deterministic remediation" rules have a correct fix mechanically derivable from data Dex
// already has -- no LLM call, no ProofLayer (proof-layer.ts's checks are tuned for prose:
// 155-char guidance, claim-pattern matching against page title -- none of that applies to a
// markup snippet). The directive itself allows "ProofLayer OR deterministic validation" for
// exactly this case. This module is the deterministic counterpart: template generation +
// a lightweight, rule-specific validator producing the same {outcome, checksRun, reasoning}
// shape ProofLayer does, so the review UI/GuardResult table need no new code path.

export interface DeterministicCheckResult {
  check: string;
  result: 'pass' | 'fail';
  detail: string;
}

export interface DeterministicValidationResult {
  outcome: ProofOutcome;
  checksRun: DeterministicCheckResult[];
  reasoning: string;
}

// missing_canonical and invalid_canonical share one fix: a self-referencing canonical is always
// correct for the page it's on, regardless of whether the tag was absent or malformed -- see
// the Phase 1F design doc's reasoning for both rows.
export const CANONICAL_FIX_RULE_IDS = ['missing_canonical', 'invalid_canonical'] as const;
export const CANONICAL_FIX_ACTION_TYPE = 'canonical_fix';

// Minimal escaping for safe embedding inside an HTML attribute value -- a crawled pageUrl is
// untrusted data (see docs/superpowers on the untrusted-data boundary); a literal `&` or `"`
// inside it must not break the generated tag's own attribute syntax.
function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function generateCanonicalFix(pageUrl: string): string {
  return `<link rel="canonical" href="${escapeHtmlAttr(pageUrl)}">`;
}

// Self-generated content validated against the exact input it was generated from -- this will
// pass in every real case today. It exists anyway, at the same rigor the meta_description path
// has, as a real safety net: if a future change ever passes the wrong URL in, this is what
// catches it before a customer sees a canonical tag pointing at the wrong page.
export function validateCanonicalFix(draftContent: string, pageUrl: string): DeterministicValidationResult {
  const wellFormed: DeterministicCheckResult = /^<link rel="canonical" href="[^"]*">$/.test(draftContent)
    ? { check: 'tag-well-formed', result: 'pass', detail: 'Generated tag matches the expected canonical-link shape.' }
    : { check: 'tag-well-formed', result: 'fail', detail: 'Generated tag does not match the expected canonical-link shape.' };

  const expectedHref = `href="${escapeHtmlAttr(pageUrl)}"`;
  const referencesCorrectPage: DeterministicCheckResult = draftContent.includes(expectedHref)
    ? { check: 'references-correct-page', result: 'pass', detail: 'Canonical href matches the page this fix is for.' }
    : { check: 'references-correct-page', result: 'fail', detail: 'Canonical href does not match the page this fix is for.' };

  const checksRun = [wellFormed, referencesCorrectPage];
  const failed = checksRun.filter((c) => c.result === 'fail');

  if (failed.length > 0) {
    return { outcome: 'block', checksRun, reasoning: failed.map((c) => c.detail).join(' ') };
  }
  return { outcome: 'pass', checksRun, reasoning: 'All checks passed.' };
}

// --- missing_structured_data (a minimal WebPage schema, any page) and missing_entity_markup
// (an Organization schema, homepage only) -- distinct fixes, distinct actionTypes. Unlike
// canonical_fix's identical remediation for two rule IDs, these two rules produce genuinely
// different content, so each gets its own generator per the design doc's per-row reasoning.

export const STRUCTURED_DATA_FIX_RULE_IDS = ['missing_structured_data'] as const;
export const STRUCTURED_DATA_FIX_ACTION_TYPE = 'structured_data_fix';

export const ENTITY_MARKUP_FIX_RULE_IDS = ['missing_entity_markup'] as const;
export const ENTITY_MARKUP_FIX_ACTION_TYPE = 'entity_markup_fix';

// A JSON-LD payload is later embedded inside a literal <script> element a customer pastes onto
// their own page. A closing-script-tag sequence inside a JSON string value (e.g. a page title
// containing that literal text) would otherwise let an HTML parser close the script tag early --
// escaping the forward slash there is valid JSON and neutralizes it for any HTML consumer.
function jsonLdScript(payload: Record<string, unknown>): string {
  // Capture-group replacement, not a fixed-case literal -- a naive `'<\\/script'` replacement
  // would silently flatten a real page title's "</SCRIPT" or "</Script" to lowercase, corrupting
  // the exact text a customer's page actually has. Preserving the matched case here is what
  // keeps the generated JSON-LD name field byte-for-byte faithful to the source.
  const json = JSON.stringify(payload).replace(/<\/(script)/gi, (_match, tag: string) => `<\\/${tag}`);
  return `<script type="application/ld+json">${json}</script>`;
}

// No invented facts: `name` is only included when a real page title exists. A page with no
// title still gets a valid, honest WebPage schema (just url), not a fabricated name.
export function generateStructuredDataFix(pageUrl: string, pageTitle: string | null): string {
  const payload: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'WebPage', url: pageUrl };
  if (pageTitle) payload.name = pageTitle;
  return jsonLdScript(payload);
}

// organizationName is the customer's own ClientProfile.name (a required field, never invented)
// -- the only fact this fix needs, and Dex already has it.
export function generateEntityMarkupFix(homepageUrl: string, organizationName: string): string {
  return jsonLdScript({ '@context': 'https://schema.org', '@type': 'Organization', name: organizationName, url: homepageUrl });
}

function extractJsonLd(draftContent: string): { ok: true; data: Record<string, unknown> } | { ok: false } {
  const match = /^<script type="application\/ld\+json">([\s\S]*)<\/script>$/.exec(draftContent);
  if (!match) return { ok: false };
  try {
    // Mirrors jsonLdScript's case-preserving escape above -- must reverse it exactly, not
    // case-flatten, or a validated/re-parsed payload would silently disagree with what was
    // actually stored as draftContent.
    const unescaped = match[1].replace(/<\\\/(script)/gi, (_match, tag: string) => `</${tag}`);
    const parsed: unknown = JSON.parse(unescaped);
    if (!parsed || typeof parsed !== 'object') return { ok: false };
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

// Shared validator for both JSON-LD fixes above -- same "self-generated, validated against its
// own input" safety-net reasoning as validateCanonicalFix.
export function validateJsonLdFix(draftContent: string, expectedType: string, expectedUrl: string): DeterministicValidationResult {
  const extracted = extractJsonLd(draftContent);

  const wellFormed: DeterministicCheckResult = extracted.ok
    ? { check: 'tag-well-formed', result: 'pass', detail: 'Generated content is a valid JSON-LD <script> block.' }
    : { check: 'tag-well-formed', result: 'fail', detail: 'Generated content is not a valid JSON-LD <script> block.' };

  const typeMatches: DeterministicCheckResult =
    extracted.ok && extracted.data['@type'] === expectedType
      ? { check: 'schema-type-correct', result: 'pass', detail: `Schema type is ${expectedType}.` }
      : { check: 'schema-type-correct', result: 'fail', detail: `Schema type is not ${expectedType}.` };

  const urlMatches: DeterministicCheckResult =
    extracted.ok && extracted.data.url === expectedUrl
      ? { check: 'references-correct-page', result: 'pass', detail: 'Schema url matches the page this fix is for.' }
      : { check: 'references-correct-page', result: 'fail', detail: 'Schema url does not match the page this fix is for.' };

  const checksRun = [wellFormed, typeMatches, urlMatches];
  const failed = checksRun.filter((c) => c.result === 'fail');

  if (failed.length > 0) {
    return { outcome: 'block', checksRun, reasoning: failed.map((c) => c.detail).join(' ') };
  }
  return { outcome: 'pass', checksRun, reasoning: 'All checks passed.' };
}
