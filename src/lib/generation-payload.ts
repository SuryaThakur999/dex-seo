import { createHash } from 'node:crypto';

// Phase 1C (docs/superpowers/specs/2026-09-28-phase1c-generation-queue-adr.md): deterministic
// idempotency key so a duplicate enqueue (double page-load, concurrent tab, a retried HTTP
// request) is a no-op against the same GenerationJob row, never a second job. inputFingerprint
// is whatever makes this actionType's output content-distinct for this target (see each
// payload variant below) -- not the full payload, which can carry supporting data (e.g.
// internal_link_fix's candidate list) that doesn't itself change what a re-run would produce.
export function computeIdempotencyKey(
  customerId: string,
  websiteId: string,
  actionType: string,
  targetRef: string,
  inputFingerprint: string
): string {
  const stable = JSON.stringify([customerId, websiteId, actionType, targetRef, inputFingerprint]);
  return createHash('sha256').update(stable).digest('hex');
}

export interface RestrictedWordingMatchInput {
  phrase: string;
  excerpt: string;
}

export interface CandidatePageInput {
  url: string;
  title: string | null;
}

// One variant per in-scope actionType (the ADR's scope: run-scan.ts's 6 actionTypes +
// retry-draft). Each variant carries exactly what its generator needs to run -- tenant-wide
// context (approvedFacts, restrictedWording, clientProfile name) is deliberately NOT baked in
// here; it's fetched fresh at claim time in generation-worker.ts so a job that waits through a
// retry backoff uses current facts, not what was true when it was enqueued.
// findingId is the real DB id of the causal Finding this job's generation is remediating --
// null means no Finding record exists for this trigger (e.g. meta_description, which is
// flagged by growth-brain.ts's pure heuristic, not by a Finding), not "we lost track of one
// that does." See docs/superpowers/plans/2026-10-12-action-provenance-producer-wiring-note.md.
export type GenerationPayload =
  | { actionType: 'meta_description'; url: string; title: string | null; metaDescription: string | null; h1: string | null; findingId: null }
  | { actionType: 'canonical_fix'; pageUrl: string; currentCanonical: string | null; findingId: string | null }
  | { actionType: 'structured_data_fix'; pageUrl: string; title: string | null; findingId: string | null }
  | { actionType: 'entity_markup_fix'; pageUrl: string; findingId: string | null }
  | {
      actionType: 'restricted_wording_fix';
      pageUrl: string;
      matches: RestrictedWordingMatchInput[];
      title: string | null;
      metaDescription: string | null;
      findingId: string | null;
    }
  | {
      actionType: 'internal_link_fix';
      targetUrl: string;
      targetTitle: string | null;
      candidates: CandidatePageInput[];
      findingId: string | null;
    };

// canonical_fix's output is always identical for a given URL (a self-referencing canonical
// tag) -- the URL itself is the whole fingerprint, matching run-scan.ts's existing "any status
// blocks re-creation" dedup for this rule.
export function canonicalFixFingerprint(pageUrl: string): string {
  return pageUrl;
}

// structured_data_fix's JSON-LD embeds the page title -- content changes if the title changes.
export function structuredDataFixFingerprint(title: string | null): string {
  return title ?? '';
}

// entity_markup_fix's JSON-LD embeds the customer's ClientProfile.name -- content changes if
// the customer's own profile name changes.
export function entityMarkupFixFingerprint(clientProfileName: string): string {
  return clientProfileName;
}

// meta_description's real input is the page's own title/metaDescription/h1 -- identical to
// run-scan.ts's existing computeContentHash concept (same fields, same reason: a fresh draft
// against unchanged source content would just recreate what's already there).
export function metaDescriptionFingerprint(page: { title: string | null; metaDescription: string | null; h1: string | null }): string {
  return JSON.stringify({ title: page.title, metaDescription: page.metaDescription, h1: page.h1 });
}

// restricted_wording_fix's real input is the matched phrase+excerpt pairs -- if the page's
// flagged text changes, the draft should be allowed to regenerate.
export function restrictedWordingFixFingerprint(matches: RestrictedWordingMatchInput[]): string {
  return JSON.stringify(matches);
}

// internal_link_fix's real input is the target page plus the exact candidate pages offered --
// a later scan with a different site inventory is a genuinely different suggestion, not a
// duplicate of an earlier one.
export function internalLinkFixFingerprint(candidates: CandidatePageInput[]): string {
  return JSON.stringify(candidates);
}
