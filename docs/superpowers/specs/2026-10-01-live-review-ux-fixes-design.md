# Design: four live-product UX/data-integrity fixes found in a production review audit

**Date:** 2026-10-01
**Status:** Approved (expedited — four independently-scoped, already-diagnosed bugs, not one ambiguous feature)
**Source:** Live audit of dex-ai-plum.vercel.app across Review, Analytics, and Settings on real accounts (Heart to Home Meals, Roland Berger, Tauro, NanoDiagnostics, example.com, Yoki) during this session.

## Context

A live smoke-test of the Phase 1C/1E deploy surfaced four pre-existing product bugs, unrelated to Phase 1C/1E themselves but real and reproducible. Each is independently scoped; bundling them into one spec avoids four near-empty documents for genuinely small fixes, while still giving each its own section so the plan stays traceable.

## Issue 1 — Review queue list shows no fix-type label

**Problem:** `/review`'s list renders only URL + PASS/FAIL + timestamp per row. With 100+ pending items, multiple rows for the same URL (different `actionType`s — canonical fix, structured data fix, entity markup fix, etc.) are visually identical. A reviewer cannot tell what they're approving without opening every row.

**Fix:** `Action.actionType` already exists on every row. Add a small, human-readable type badge to each list row (e.g. `meta_description` → "Meta description", `canonical_fix` → "Canonical fix", `internal_link_fix` → "Internal link"). Reuse whatever label map already exists for the detail view (action-detail.tsx) if one exists, rather than inventing a second copy of the same strings.

**Scope boundary:** Labeling only. A filter/group-by-type control is a reasonable follow-up but not required to fix the actual complaint (indistinguishable rows) — do not build it as part of this fix.

## Issue 2 — Crawler treats sitemap.xml files as real pages

**Problem:** NanoDiagnostics' queue contains an `internal_link_fix` drafted for `nanodiagnostics.com/page-sitemap.xml` — an XML file, not a page a visitor reads. The generated draft text is garbled ("site map" repeated with no real anchor text), because the crawler fetched the XML response and ran HTML-oriented parsing (title extraction, meta parsing) on it as if it were a page.

**Fix:** Find where `.xml` URLs enter the discovered-page list (`fetchSitemapUrls`/`mergeSitemapUrls` in `gsc-client.ts`/`crawler.ts`, and `discoverPagesWithoutGsc` in `run-scan.ts`) and exclude sitemap/non-HTML URLs from that list at the source, not by patching the draft output downstream. The actual root cause (sitemap URLs leaking into the "real page" list vs. only the URLs *contained in* a sitemap) needs to be confirmed by reading the code before fixing — do not guess and patch a symptom.

**Scope boundary:** Fix the page-discovery filter. Do not add a general content-type-sniffing system — matching on file extension (`.xml`, and any other sitemap-index patterns found during investigation) is sufficient for this bug.

## Issue 3 — Settings' Search Console health badge disagrees with reality

**Problem:** Two sites with the same underlying failure class show different Settings states. `example.com` shows calm green "Search Console connected" despite 17 consecutive days of identical scan failures ("Dex's Google OAuth client configuration was rejected"). `yoki-ai-fintech.fly.dev` correctly shows amber "Reconnect needed" for a similar GSC failure. Separately, every other real site (Heart to Home Meals, Roland Berger, Tauro, NanoDiagnostics) shows "Google account linked — select a property" with an empty input, despite scanning successfully for weeks via the no-GSC crawl path — with no copy explaining that this is a harmless/optional state, not broken setup.

**Fix, part A (the lie):** `run-scan.ts`'s catch block only sets `website.gscReconnectRequired = true` for errors that are `instanceof GoogleAuthError`. Confirm whether "OAuth client configuration was rejected" is being thrown as a different error type that bypasses this branch, and if so, broaden the classification so this failure class also sets the flag. Do not touch the DB schema — this is a classification-logic fix only.

**Fix, part B (the false alarm):** Add one line of copy to the "select a property" empty state: crawl-only audits already work without a selected GSC property; this step is optional, improves data richness, isn't required for audits to run.

**Scope boundary:** Do not redesign the Settings page. Two targeted changes: broaden error classification, add one clarifying copy line.

## Issue 4 — Analytics bars render percentages over 100%

**Problem:** The Analytics tab's audit-funnel bars show "Findings: 63 (158%)" and "Draft-ready: 84 (133%)" — percentages computed against "pages discovered" as a 100% baseline, which isn't a valid ceiling for counts that can naturally exceed 1-per-page (multiple findings/drafts per page). The bar element renders clamped to its container's full width while the label claims to exceed it — visually reads as a broken progress bar.

**Fix:** Clamp the bar's rendered width at 100% (`Math.min(100, pct)`) while keeping the real, uncapped percentage in the text label. Standard treatment for an over-capacity funnel-style bar — the number tells the true story, the bar shows "this metric exceeded its baseline" without visually overflowing its container.

**Scope boundary:** Rendering fix only. Do not change what's measured or add a new baseline/metric.

## Team assignment

- **Agent "Growth"** (`product-skills:cs-product` + `marketing-skills:cro` + `marketing-skills:analytics` lens): Issues 1 and 4 — both are about making the product's own feedback loop (the review queue is literally the draft→approved conversion funnel; Analytics is the trust surface for that funnel) legible and correct.
- **Agent "Trust"** (c-level trust/communication lens + engineering correctness): Issues 2 and 3 — both are "the product tells the customer something false" bugs (a garbled draft that passed review, a status badge that doesn't match reality).

The two agents coordinate directly (not just report to the orchestrating session) since: Issue 1's human-readable actionType labels and Issue 3's clarifying copy should share tone/naming conventions, and Issue 2's page-list filtering reduces what Issue 1's list even needs to display.

## Testing

Existing test suites (`review-queue-list.test.tsx`, `run-scan.test.ts`, settings component tests, Analytics component tests if they exist) are the primary coverage. Add focused test cases for each fix (label rendering, sitemap exclusion, error-classification branch, bar clamping) matching this codebase's existing test conventions. Full `vitest run` + `tsc --noEmit` + `next build` must stay clean, same bar as every other change this session.

## Out of scope

- Filter/group-by-type UI for the review queue (Issue 1 follow-up)
- Settings page redesign beyond the two targeted changes (Issue 3)
- New Analytics metrics or baselines (Issue 4)
- Any change to Phase 1C/Phase 1E code from earlier in this session
