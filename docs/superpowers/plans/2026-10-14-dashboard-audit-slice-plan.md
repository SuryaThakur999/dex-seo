# Dashboard Audit Slice (13 items) — Plan

> Inline execution by Dwight (one reviewer/builder, no subagent dispatch). Tests first per item, commit per item.

**Goal:** Fix the 13 non-overseer items from the production dashboard audit (2026-10-14T20:03Z), all code-level bugs/UX gaps found via a signed-in production walkthrough at 375/1280px.

**Not in scope:** the 5 items overseer ships themselves on `fix/dashboard-audit-small` (Studio opens From opportunity, Not-connected badge consolidation, plain disclosure copy, proof-icon aria-labels, no transition-all on tabs). German UI localization (separate human decision).

## Global constraints
- Tier 2 design rule: tests first, all six design skills with per-skill receipts at ship time.
- Screenshots at 320/768/1280px — still blocked on Clerk test credentials in this sandbox; note explicitly, don't skip silently.
- Card consolidation (item 5) is additive: move cards, keep their existing effects/behavior, don't delete.

---

### Item 1 — AI summary contradicts Work feed
**File:** `src/lib/dashboard-insight.ts:34` (`pages_flagged_by_prooflayer_all_time` uses `input.guardCatches`, an all-time count)
**Fix:** rename/re-source so the summary is built from the latest scan's findings/drafts, matching what the Work feed shows, not an all-time total. Caller (`src/app/dashboard/[websiteId]/page.tsx`) passes `guardCatches` in — trace where that value comes from and pass the latest-scan equivalent instead.
**Test:** `dashboard-insight.test.ts` — assert the prompt's `pages_flagged` label is built from the scan-scoped count, not an all-time one.

### Item 2 — Scan audits login/account pages
**File:** `src/lib/run-scan.ts:113-114` (`discoverPagesWithoutGsc`'s filter only excludes sitemap URLs)
**Fix:** add `isAuthOrAccountPath(url)` to `crawler.ts` (same pattern as `isSitemapUrl`) matching `/sign-in|signin|sign-up|signup|log-in|login|account|register|cart|checkout/`. Apply it to `performance` once, after both the GSC and no-GSC paths converge (covers both discovery sources, not just the no-GSC one). Add `hasNoindexMeta(html)` to `crawler.ts` (checks `<meta name="robots">` content for a `noindex` token); skip a page in the main loop right after fetch if noindex, same as the existing `html === null` skip.
**Test:** `crawler.test.ts` for both new functions; `run-scan.test.ts` asserting a discovered `/sign-in` URL and a noindex-flagged page are excluded from `pagesAttempted`/`pagesScanned`.

### Item 3 — Internal-link suggestion shows raw pipe text
**Files:** `src/lib/internal-link-fix.ts:76-87` (produces `url | anchor text` lines), `src/components/review/action-detail.tsx:168` (renders via `computeDiff`, presumably as plain text)
**Fix:** keep `draftContent`'s stored format (don't change the model contract / stored data), add a parser that turns `URL | anchor text` lines into `{url, anchorText}[]` and render that as a real link list in `action-detail.tsx` (anchor text as link label, title/href = URL), falling back to the plain-sentence case ("nothing relevant") unchanged.
**Test:** parser unit test (valid lines, the no-match sentence, malformed line ignored) + `action-detail.test.tsx` rendering a link list instead of raw text for an `internal_link_fix` action.

### Item 4 — Two URL inputs on Mission Control
**Files:** `src/components/dashboard/website-entry-panel.tsx:60`, `src/components/command-bar.tsx:48`
**Fix:** read both to see which is the dashboard's primary add-site entry point vs. a global command-bar action; keep the one that's the actual data-entry UI (`website-entry-panel`), remove/replace the command-bar's duplicate add-URL field with a call to action that opens/focuses the panel instead of being its own parallel text input.
**Test:** update/add a `command-bar.test.tsx` case asserting it no longer renders a second URL `<input>`.

### Item 5 — Pending count / scan status triplicated (~18 cards)
**Fix:** add one "Today" card at the top of Mission Control (what's waiting + one primary button), move the secondary duplicate cards to the Analytics tab. Additive: existing cards keep their component code and effects, just relocate in the page tree; the new Today card is a thin new component composing already-available counts (no new data fetching).
**Test:** component test for the new Today card (renders the pending/waiting count + one CTA) + a page-level test asserting the moved cards now render under the Analytics tab section.

### Item 6 — Work feed card empty below badge
**File:** `src/components/dashboard/work-feed.tsx:82-83`
**Fix:** render the top 3 findings below the badge instead of leaving the card body empty.
**Test:** `work-feed.test.tsx` — given findings, shows up to 3; given zero, falls back to existing empty-state copy.

### Item 7 — Opportunity map misleading with mostly-unrated dots
**File:** `src/components/dashboard/opportunity-map-chart.tsx:75`
**Fix:** hide the chart (show a plain "not enough rated opportunities yet" message instead) until at least 3 items have a real rating.
**Test:** renders nothing/placeholder at 0–2 rated, renders the chart at 3+.

### Item 8 — Site graph '/' vs 'Home' duplicate nodes
**File:** `src/lib/site-graph.ts:22-23`
**Fix:** normalize URLs (strip trailing slash before comparison/dedup key) before building nodes.
**Test:** two input URLs differing only by trailing slash collapse to one node.

### Item 9 — Mobile: Top opportunities clips columns
**File:** `src/components/dashboard/opportunity-board.tsx:59-62` (`min-w-[480px]` forces horizontal scroll/clip on mobile)
**Fix:** stacked-card layout below `md`, keep the existing table layout at `md`+.
**Test:** existing opportunity-board tests still pass; add/adjust a test asserting the mobile stacked-card markup renders (e.g., no `min-w` table wrapper at small viewport class list, or a dedicated mobile card component is present).

### Item 10 — Mobile Review rows show only `https://…`
**File:** `src/components/review/review-queue-list.tsx:230`
**Fix:** show the path (e.g. `/preise`) plus the fix type, not the bare origin-truncated URL.
**Test:** `review-queue-list.test.tsx` asserting the mobile row text includes path + fix type.

### Item 11 — Review lists items twice
**Files:** `src/app/review/page.tsx:81` ("Needs decision" list) and the separate "Site changes" list; header copy at `page.tsx:72`
**Fix:** keep one list, remove the duplicate; reword the header from "loaded inbox entries" phrasing to "N changes waiting for your decision".
**Test:** `review/page.test.tsx` — one list rendered, header text matches the new copy.

### Item 12 — Hide "Tokens spent" from customers
**File:** `src/app/dashboard/[websiteId]/page.tsx:596`
**Fix:** remove/condition out the Tokens-spent display from the customer-facing dashboard.
**Test:** page test asserting "Tokens spent" text is absent.

### Item 13 — Plain-language labels
**Fields:** Canonical tag, Structured data, Entity markup, ProofLayer, Specialist names (wherever each is labeled in finding/action UI — likely `action-detail.tsx` / a shared label map)
**Fix:** lead with a plain phrase (e.g. "Tell Google which page is the main one"), technical name small underneath — same pattern already used in `profile-suggestions-panel.tsx`'s `FIELD_LABELS` (plain label as primary text).
**Test:** component test(s) asserting the plain phrase renders as the primary text and the technical name is present but secondary (e.g., smaller/muted class) for each of the 5 fields.

---

## Verification gate (every item, before shipping)
- `npx tsc --noEmit`
- `npx vitest run` (full suite)
- `NODE_ENV=production npx next build`
- Design receipts: one line per skill (emil-design-eng, ui-ux-pro-max, ui-styling, apple-design, impeccable, soft-skill) per visually-changed item.
- Screenshots 320/768/1280px: attempt, report blocker if still blocked (Clerk test creds).
