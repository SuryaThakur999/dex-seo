# Competitor discovery and answer-gap finding (design)

Date: 2026-10-17. Status: approved by the human (option A plus self-found competitors; found competitors are watched right away). Replaces the deferred use case 5 in `2026-10-14-phase2g-agent-reach-use-cases-design.md`. Builds on G5 Competitor Watch, `CompetitorEntity`, `competitor-resolver.ts` and the Agent Reach web channel.

## Problem

Use case 5 was blocked for two reasons. Dex has no finding that says a page does not answer a question; `geo-specialist.ts` only emits `ai_crawlers_blocked` and `missing_entity_markup`. And competitors only exist when the owner types them in, which most SMB owners never do, so Competitor Watch and any competitor comparison stay empty.

## Part 1: Dex finds competitors itself

**When:** after a scan completes, and in the weekly competitor-watch cron before the watch runs.

**Steps:**
1. Read the company's Marketing Memory (business description, services, markets, language) from its `ClientProfile`. If the description is empty, skip and log "not enough company information".
2. The LLM proposes up to 10 candidates as `{ name, domain }`, prompted to name only real companies serving the same market and region. Fetched text and LLM output are untrusted data.
3. Verify each candidate: normalise the domain, run it through `safe-fetch` (allowlist and SSRF checks), then read the homepage through the Agent Reach web channel. Drop any candidate whose page does not load, is parked, redirects to another company, or is the owner's own domain.
4. Classify each verified candidate with the existing `classifyCompetitor`, using only the fetched page text. Keep the one-line reason.
5. Keep at most 5 `direct` candidates per company (fewer if the company already has watched competitors; total watched stays at most 5).
6. Store as `CompetitorEntity` with `source = 'dex_found'`, `userConfirmed = false`, and the classification reason. They join the weekly watch immediately.

**Owner control:** Settings > Competitors and the Competitors card label these "Found by Dex" with the reason. The owner can remove one. A removed domain is never re-added: removal keeps the row and sets `classification = 'rejected_by_owner'` (classification is a free string, so no schema change). Discovery skips any domain with that classification.

**Budget and safety:** one discovery run per company per week; per-job token budget and circuit breaker as in G1; robots.txt respected; 500-character excerpts; Agent Reach version recorded on the `ResearchJob`.

## Part 2: answer-gap finding

**Detector (deterministic, no LLM):** for each scanned page, the page has a question-and-answer section if any of these is true:
- FAQPage or QAPage JSON-LD is present;
- at least one H2 or H3 ends with "?" or starts with a question word (DE: wie, was, warum, wann, wo, welche, wer, kann, ist; EN: how, what, why, when, where, which, who, can, is, does);
- the first paragraph after the H1 is 40 words or fewer and directly follows it.

If none is true, emit finding `missing_answer_section`: "No question-and-answer section found." Evidence: the H1 and the H2/H3 list checked. Skip legal pages (Impressum, Datenschutz, AGB, privacy, terms) and pages under 150 words.

**Competitor excerpt:** from the latest competitor-watch evidence items of watched competitors, pick a page whose title or H1 shares at least 2 non-stopword terms with this page's H1. Show its dated excerpt beside the finding with the label "Matched by shared words in the title: <terms>". No match, no excerpt. Never attach an excerpt to an unrelated finding.

**Draft:** the finding gets a draft FAQ section (3 to 5 questions) built from the page's own text and approved claims only; the claims guard blocks anything not in the page or Marketing Memory. The owner approves before anything changes (manual apply, as today).

## Not doing

- Paid SERP APIs or logged-in channels.
- Auto-publishing the FAQ draft.
- Any "will rank" or "will be cited" promise.

## Schema

None. `CompetitorEntity.source` and `classification` are strings; the new values are `dex_found` and `rejected_by_owner`.

## Build order and review

1. Slice 1, competitor discovery: Pam builds, Dwight reviews (outside fetches, security).
2. Slice 2, answer-gap finding and excerpt: Pam builds, Ryan reviews UI and copy.

Tests first. Tier 2 design rule for the "Found by Dex" label and the finding card; overseer takes signed-in screenshots at 320, 768 and 1280px.

## Acceptance

- Discovery: candidates that fail fetch or classify as non-direct are not stored (tests with fixtures); never more than 5 watched; removed domains are never re-added; own domain excluded.
- Detector: tests for each of the three positive signals, the legal-page skip and the short-page skip, in German and English.
- Excerpt: shown only with 2 or more shared terms; label lists the terms; no excerpt without a match.
- Draft: claims guard test proving no fact outside the page or Marketing Memory reaches the draft.
