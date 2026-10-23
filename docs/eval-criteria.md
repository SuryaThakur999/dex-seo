# Eval Criteria — Creation Engine + GrowthGuard (Phase 1)

**Status:** Draft, pending founder approval
**Date:** 2026-08-14
**Why this exists:** Per CAIO-advisor's first question — "what does this AI need to be good at, and how would you measure it? If no eval set, no ship." Nothing in the technical architecture doc defines what a *good* meta-description draft looks like or what counts as GrowthGuard working correctly. This is that definition, small enough to actually run before Week 3.

## 1. Creation Engine — meta description quality

**Golden set:** before Week 3, hand-pick 10 real pages from 2-3 volunteer/test websites (mix of thin-content pages and well-written ones) and hand-write what a *good* meta description would look like for each. This is the baseline to compare generated output against — not a hypothetical, an actual file to create with real URLs once a test site is available.

**Per-draft scoring (manual, not automated, for Phase 1 — 10 drafts is small enough to eyeball):**

| Criterion | Pass condition |
|---|---|
| Accurate | Contains no claim absent from the source page content |
| Relevant | Describes what's actually on the page, not generic filler |
| Within length | ~120-155 characters (Google's display guidance) |
| Distinct | Not a near-duplicate of another page's draft for the same customer |
| Natural | Reads like something a person would write, not keyword-stuffed |

**Ship gate:** at least 8 of 10 golden-set drafts pass all five criteria before Week 3 review-UI work is considered done. If fewer than 8 pass, the Creation Engine prompt needs iteration before shipping, not the review UI.

## 2. GrowthGuard checklist — correctness

Each of the five checks (technical architecture doc Section 3) needs at least one deliberately-bad test input that should trigger it, and one clean input that should pass it. This is a small, concrete test suite, not an abstract requirement:

| Check | Should BLOCK/FLAG on... | Should PASS on... |
|---|---|---|
| AI-content disclosure | An action missing the disclosure flag entirely | Any action with the disclosure attached (this should be impossible to fail by construction, but test it anyway) |
| No unverifiable factual claims | A draft containing "#1 rated" or a specific percentage not in the source content | A draft with no invented numbers or superlatives |
| No contradiction of source content | A draft claiming a product is "in stock" when the crawled page says otherwise | A draft that only restates what's actually on the page |
| Length/format validity | A draft over ~155 characters | A draft within range |
| Duplicate-risk | Two near-identical drafts for different pages on the same customer | Two drafts with genuinely distinct content |

**Ship gate:** all 5 checks correctly block/flag their bad-input test case and correctly pass their clean-input test case before GrowthGuard is considered "wired to every draft" (build order Week 2 item). This is a natural fit for a small automated test file (e.g. Vitest) rather than manual verification, since it's pure logic with no LLM call involved.

## 3. What's explicitly NOT in scope for Phase 1 eval

- Automated/continuous eval pipeline — 10 manually-scored drafts is enough for an MVP with zero customers; build real eval infrastructure once there's production volume to monitor (this is also one of the five general controls the CAIO risk-classifier surfaced: "monitoring of model output in production" — deferred, not forgotten, tracked in strategy doc Section 10).
- GEO/AI-citation accuracy eval — out of scope, GEO monitoring isn't in Phase 1.
- Learning Engine outcome evaluation — deferred with the Learning Engine itself until 10 paying customers exist.

## 4. Next step

Create the actual 10-page golden set once a test website is available (founder's own site, or a volunteer's) — this can happen in parallel with Week 1 scaffolding, doesn't block it.
