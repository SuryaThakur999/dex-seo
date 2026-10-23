# Phase 1F — Finding-to-Action Coverage: rule-to-category mapping

Design pass only, per the master directive's own Phase 1F rule ("map every rule before building anything") and the tracker's next-step order ("design Phase 1F before writing any implementation code"). No code changed by this document.

## The gap, confirmed against current code

`Finding` (10 real specialist rule IDs, produced by `seo-specialist.ts`/`geo-specialist.ts`/`brand-specialist.ts`) and `Action` (exactly one real type today, `meta_description`, `db.action.create` at 2 hardcoded call sites in `run-scan.ts`) are two separate pipelines with no link between them. 9 of the 10 rules below currently sit read-only on the Opportunity Board with no draft, no ProofLayer check, no review, no receipt.

## Category definitions (from the directive)

- **Automatically draftable** — a real generator can produce a draft the same way `meta_description` does today (LLM call grounded in real crawled/account data, ProofLayer-reviewed, human-approved before use).
- **Deterministic remediation** — fixable by code, not generation. The correct value is mechanically derivable from data Dex already has, no LLM call needed.
- **Human decision required** — the right fix depends on business judgment Dex can't make.
- **Informational/non-actionable** — real, evidence-backed, correctly has no automated path.

## The mapping

| Rule ID | Agent | Category | Reason |
|---|---|---|---|
| `missing_canonical` | SEO | **Deterministic remediation** | The correct fix is always a self-referencing `<link rel="canonical" href="{pageUrl}">` — no content judgment, no LLM call needed. |
| `invalid_canonical` | SEO | **Deterministic remediation** | Same safe universal fix as `missing_canonical` — replace the unparseable value with a self-referencing canonical. A self-canonical is always valid for the page it's on, regardless of what the malformed original was trying to say. |
| `canonical_points_elsewhere` | SEO | **Human decision required** | The rule's own `limitations` field already says it: "A non-self canonical can be intentional (e.g. a tracked duplicate) — verify before treating as an error." Only the customer knows intent. |
| `missing_structured_data` | SEO | **Deterministic remediation** | A minimal generic `WebPage` JSON-LD block (`name` = page title, `url` = pageUrl) is mechanically assemblable from data the crawl already parses — no page-type guess (Product vs Article vs Organization), no invented facts. Richer schema types are deliberately out of scope for the deterministic version; they'd need business judgment this rule's evidence doesn't carry. |
| `zero_internal_links` | SEO | **Automatically draftable** | Candidate internal links (target page + anchor text) can be grounded entirely in the site's own crawled page inventory (title+url pairs from the same scan) — same "real crawled facts in, ProofLayer-reviewed, human-approved" shape `meta_description` already has. (Distinct from the existing Content-Studio CTA on this same rule, which is a separate honest path — writing new content that links here — not a substitute for a direct fix.) |
| `broken_page_status` | SEO | **Informational/non-actionable** | The directive's own canonical example. Dex has no server access and no way to know *why* a page 4xx/5xx'd — deleted, moved, or a real outage — so any automated "fix" would be a guess dressed up as an action. |
| `restricted_wording_found` | Brand | **Automatically draftable** | A rewrite of the flagged excerpt, grounded in the customer's own approved-claims/brand-voice `ClientProfile` data — same shape as `meta_description`. ProofLayer's existing restricted-wording check (already built, already used to validate drafts) gates the result for free. |
| `unverified_claim_candidate` | Brand | **Human decision required** | The directive's own canonical example. Verifying a real-world business claim is true is judgment only the customer can make — Dex can't confirm facts about their business. |
| `ai_crawlers_blocked` | GEO | **Human decision required** | The finding's own evidence frames this as a policy question, not a defect: "If AI-answer discoverability matters for this site, review whether blocking them is intentional." Sites block AI crawlers deliberately (e.g. to protect proprietary content) often enough that Dex reversing it unilaterally would be presumptuous, not helpful. |
| `missing_entity_markup` | GEO | **Deterministic remediation** | Organization/WebSite JSON-LD fields (brand name, homepage URL) are already-known `ClientProfile`/crawl facts — mechanically assemblable, no LLM needed. Checked only on the homepage (see `geo-specialist.ts`'s own scoping), so there's no page-type ambiguity the way there is for `missing_structured_data` on an arbitrary page. |

**Totals:** 2 automatically draftable, 4 deterministic remediation, 3 human decision required, 1 informational. All 10 rules accounted for.

## What this document is not

This is the classification only. Per the directive's own acceptance criterion, **no rule is "done" as automatically-draftable or deterministic-remediation until its actual generator is built, tested, and reviewed** — none of the 6 rows in those two categories have a generator today. This document exists so that build work, when it happens, has a real target per rule instead of guessing case-by-case, and so the 4 rows correctly staying human-required/informational don't quietly grow a fake automation path later just because it would look like more coverage.

## Suggested build order (not authorized to start — next decision point)

1. **Deterministic remediation rows first** (`missing_canonical`, `invalid_canonical`, `missing_structured_data`, `missing_entity_markup`) — no LLM, no provider risk, smallest and safest slice, and 4 of the 10 rules close in one pass.
2. **Automatically draftable rows** (`zero_internal_links`, `restricted_wording_found`) — reuses `creation-engine.ts`'s existing untrusted-data-grounded generation pattern, needs a second `actionType` and a ProofLayer check extension (restricted-wording check already exists for meta_description; would need to also validate a body-copy rewrite, not just a short string).
3. **Human decision required / informational rows** (`canonical_points_elsewhere`, `unverified_claim_candidate`, `ai_crawlers_blocked`, `broken_page_status`) — no generator to build; these need a UI treatment (visible, evidence-backed, explicitly "no auto-fix available, here's why") rather than a code generator. Already partially served by the existing Opportunity Board read-only view; the gap is making the "why no fix" reasoning visible per-row, not fabricating one.

Each of 1 and 2 is sized like a real, independently reviewable slice (implement → Agent B → Release Observatory → deploy), same discipline as every other Phase 1 unit — not something to fold silently into a future pass.
