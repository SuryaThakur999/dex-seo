# Dex Signal Room — dashboard redesign, design spec

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development to implement.

**Goal:** Visual and interaction redesign of the four existing dashboard tabs (Overview, Analytics, Review Queue, Outcomes) into a "precision instrument" dark theme, reusing all existing data, endpoints, and auth. No backend changes, no new integrations.

**Not in scope:** SafeDeploy rewrite, Distribution/social workspace, controlled-learning instrumentation, skill registry, crawler security audit. (These belong to a separate, larger spec the founder explicitly deferred this session — see conversation record.)

## Team disclosure

No installed subagent type matches "Agent A/B/C" literally. This spec was produced by: frontend+a11y persona applied inline (token/layout decisions below), a marketing/hierarchy pass applied inline (see "Hierarchy review" section), and a genuinely independent fresh-context subagent for the prototype gate and final gate (dispatched with zero implementation context, per `superpowers:subagent-driven-development`).

## Reference matrix

Time-boxed: no fresh browser inspection performed this pass (cost/time discipline per the brief's own instruction to reuse existing findings). Matrix built from established, accurate familiarity with each product's actual authenticated app screens, not their marketing homepages — flagged honestly as this session's access limitation.

| Reference | Screen inspected | Useful pattern | Unsuitable for Dex | Source | Limitation |
|---|---|---|---|---|---|
| Linear | Issue list + detail panel | Dense row list, monospace metadata (IDs, timestamps), single accent color used only for active state | Its priority-icon system is proprietary-feeling; don't copy icon set | linear.app | No fresh screenshot this session |
| Vercel | Deployments dashboard | Status-chip + timestamp row pattern, project switcher in top bar | Heavy use of black/white only, no room for our status palette | vercel.com | No fresh screenshot this session |
| Supabase Studio | Table editor | Inset "terminal" panel treatment for SQL, monospace data grid | Full SQL-editor chrome is overkill for a metadata terminal | supabase.com | No fresh screenshot this session |
| PostHog | Insights dashboard | Small-multiple chart grid, explicit period selector next to every chart | Very metric-dense; Dex needs fewer, better-labeled panels | posthog.com | No fresh screenshot this session |
| Resend | Email logs table | Clean status-icon + relative-timestamp table row, minimal chrome | Too sparse for a review/diff workflow | resend.com | No fresh screenshot this session |
| Raycast | Command palette | Instrument-label typography (small caps, tracked-out), keyboard-first affordances | Full command-palette pattern not needed for a 4-tab dashboard | raycast.com | No fresh screenshot this session |
| shadcn/ui Blocks | dashboard-01 block | Card/table component composition, consistent spacing scale | Default light theme, generic SaaS card shapes we're deliberately avoiding | ui.shadcn.com/blocks | Public gallery, not fetched fresh this session |
| Tremor | KPI card + chart primitives | Chart-to-label pairing (unit + period stated inline) | Its default rounded "bento" card look is explicitly what the brief bans | tremor.so | Not installed; used as a pattern reference only, no new dependency added |
| shadcn-admin (GitHub) | Repo README + component tree | Sidebar-plus-topbar shell structure | Generic admin-template visual identity, not distinctive | github.com/satnaing/shadcn-admin | Repo structure only, not a live demo |
| next-shadcn-dashboard-starter | Repo README + component tree | Route-per-tab organization matching our own App Router structure | Same generic-admin-template risk as above | github.com/Kiranism/next-shadcn-dashboard-starter | Repo structure only, not a live demo |

**Three chosen main influences:** Linear (density + single-accent restraint), PostHog (labeled small-multiple charts), Resend (row-list clarity for the Review Queue). The rest are checks against generic "AI dashboard template" drift, not competing styles.

## Token contrast verification (WCAG relative luminance, computed)

| Pair | Ratio | Verdict |
|---|---|---|
| Primary text `#F1EBDD` on Canvas `#111310` | 15.7:1 | Pass (AAA) |
| Primary text on Surface `#1A1D18` | 14.3:1 | Pass (AAA) |
| Primary text on Raised `#242820` | 12.6:1 | Pass (AAA) |
| Secondary text `#B4B7AA` on Canvas | 9.2:1 | Pass (AAA) |
| Secondary text on Raised | 7.4:1 | Pass (AAA) |
| Accent `#FF965A` as **text** on Canvas | 8.7:1 | Pass |
| Accent as **button fill** with light text on top | 1.8:1 | **Fail** — dark text required on accent fill |
| Positive `#A8C98A` / Warning `#E8C16A` / Negative `#ED9290` as text on Canvas | 10.1 / 10.9 / 8.1 :1 | Pass |
| Subtle border `#34392F` vs Canvas or Surface | ~1.4-1.6:1 | **Fails WCAG 1.4.11's 3:1** for functional boundaries |

**Two concrete corrections to the starting palette, both applied:**
1. Any button/chip filled with the accent color uses **Ink `#000000` text**, never the light primary-text color. (Verified: Ink-on-accent = 9.8:1, pass.)
2. `--subtle-border` (`#34392F`) is decorative/hairline only (row dividers, card outlines at rest). A second token, `--border-strong: #4A5142`, is added for anything functional — input outlines, the selected-row indicator, and non-focus interactive boundaries. Focus rings use the accent color directly (`outline-color: var(--accent)`), never the border tokens, so keyboard focus is never dependent on the low-contrast border.

All other starting tokens pass as given.

## Hierarchy review (marketing/SEO lens, applied inline)

Read against `marketing-skills:marketing-strategy-pmm` framing (what does the primary user need to decide, in what order):

- Approved: the four-panel Overview reading order (audit command → executive summary → 3 metrics → attention/outcomes split) matches the brief's own stated priority order (what needs attention → evidence → next action → what happened after) exactly. No changes.
- Flagged and fixed in this spec: the brief's Overview metric list put "Measured outcomes" third; keeping token/scan-cost metrics out of the primary three (per brief's own rule, "do not promote token spending as the primary customer benefit") is correct and unchanged — tokens spent moves to the Secondary Detail row (section F), never a top-line metric.
- Flagged: "AI summary" must never imply diagnosis beyond what `dashboard-insight.ts`'s actual fallback logic supports — label stays exactly "AI summary," with data-period and freshness stated inline, no rewording that reads as a stronger claim (e.g. never "AI recommends" or "AI found").
- Label check: Review Queue tab must not use the word "review" ambiguously against the existing top-nav "/review" link and the prior "Scan activity" tab rename (this session's own ledger, Task 6). Resolution: this tab shows **action-approval items** (page, proposed change, guard status, age), matching what "/review" already means site-wide; keep the existing separate "Scan activity" tab as-is for scan jobs. No naming collision once this tab absorbs the actual review workflow — see Architecture note below.

## Architecture note: Review Queue tab absorbs the existing `/review` workflow

Current state: the dashboard's 4th tab area historically showed scan jobs (renamed "Scan activity" in the prior session), while actual action approve/edit/reject/diff lived on a separate route (`/review`, `/review/[actionId]`). This spec's brief explicitly asks for a "Review Queue" tab with page/proposed-change/guard-status/age/action rows and inline diff detail — i.e., pulling `/review`'s real functionality into a dashboard tab.

Decision: build a genuine master-detail Review Queue tab (list left ~5/12, diff detail right ~7/12 on desktop, list-only with full-screen `/review/[actionId]` navigation on mobile/tablet). Reuses the exact same Prisma query shape already in `src/app/review/page.tsx`, the exact diff computation in `src/lib/diff.ts`, and the exact approve/edit/reject API routes already shipped. No new backend logic. The existing `/review` and `/review/[actionId]` routes stay in place unchanged (still reachable directly, still the mobile detail target) — this is additive, not a replacement.

The existing "Scan activity" tab (scan jobs / LiveScanPanel) is retained as a separate secondary-detail element per section F ("compact scan activity"), not removed.

## Layout — desktop shell

- Icon rail already exists (`src/components/app-shell/icon-rail.tsx`, 64px, `/dashboard` `/review` `/settings`) — retained, restyled to new tokens, tooltips upgraded from native `title` to the existing Radix `ui/tooltip.tsx` component for real accessible tooltips, focus-visible ring added (accent color, per contrast finding above).
- Top utility bar (new): current site (`customer.websiteUrl`), connection state (existing `gscConnected` badge, restyled), last refresh (latest scan job's `completedAt`, existing data), account control (Clerk's `UserButton`, not yet present — add it here, it's an existing Clerk primitive, not a new integration).
- Single-site product: no site switcher. Site name renders as static text in the utility bar.
- Content max-width 1440px, 24-32px padding, matches brief exactly.

## Overview tab

Reuses: `db.action.findMany` (existing query in `page.tsx`), `computeDashboardStats`, `computeOutcomesSummary`, `generateDashboardInsight` (existing, cached, Suspense-wrapped — unchanged), the existing `/api/scan` POST action.

- A. Heading + one-line supporting text (site + data freshness).
- B. Audit command panel: reuses the existing `/api/scan` connected-site action (there is no arbitrary-URL scan endpoint — labeled honestly as "Scan getbetter.io" style, not a fake generic URL box). Real scan status shown beside the button (existing `ScanJob.status`). Expandable terminal below, collapsed by default, built on the existing `ScanTerminal` component (already real-data, no typewriter effect) fed by existing scan-job events — not the decorative marketing `ui/terminal.tsx`.
- C. Executive summary: existing `AiInsightSection`/`AiInsightCard`, relabeled/restyled only, same "AI summary" label, same fallback behavior, same `unstable_cache` wiring.
- D. Three metric panels, restyled `StatCard`: Pending review (`stats.pendingCount`), Pages scanned in period (`latestSummary.pagesScanned`, period = last scan), Measured outcomes (`outcomesSummary.measuredCount`, with win/loss breakdown as the secondary line, not a raw count alone).
- E. Two-column ~7:5: left "Needs your attention" (top N pending actions, page + issue + guard status + link to that item in the new Review Queue tab); right "Observed outcomes" using `outcomesSummary` (measured count, comparison basis stated as text, "no measured outcomes yet" honest empty state already exists, reused).
- F. Secondary detail: compact scan activity (existing `LiveScanPanel`, restyled, moved here as the "Scan activity" content) + `GuardBreakdown` donut (existing, restyled) + tokens-spent line (moved out of primary metrics per Hierarchy review above).

## Analytics tab

Reuses: existing `DateRangeSelect`, `MiniBarChart` x3, `PassRateBullet`, existing range-threaded series functions. Changes: explicit "Filters: pages scanned, ProofLayer catches, tokens spent — action-outcome windows below are always a fixed 28 days regardless of this selector" line added directly under the range selector (prevents the exact misreading the brief warns against). Units/legend/period added to every chart per brief. Missing-data (no scans in a bucket) rendered as a visible gap in the series, not coerced to zero — requires a small change to the series-computation functions to emit `null` for buckets with no underlying job rather than `0`; charts already use Recharts, which renders `null` as a gap natively.

## Review Queue tab (new master-detail component)

See Architecture note above. New component `review-queue-panel.tsx`: left list (search input — client-side filter over the already-fetched pending actions, no new API; status/age/page columns), right detail panel reusing the diff-rendering logic from `/review/[actionId]/page.tsx` (extracted into a shared component if the extraction is small and low-risk; otherwise the detail panel fetches `/review/[actionId]` content via the same server query, duplicated minimally — implementer's call, documented either way). Keyboard focus returns to the triggering list row when the detail panel or any confirmation dialog closes. Confirmation step preserved for approve/reject (existing behavior, restyled only).

## Outcomes tab ("evidence record" treatment)

Reuses: `computeOutcomesSummary`, the four Phase-5 `Action` fields (`baselinePerformance`, `outcomePerformance`, `baselineCapturedAt`, `outcomeMeasuredAt`). Adds: an evidence table (page/action, baseline period, outcome period, observed click/impression delta, measurement status, link to the existing PDF evidence export route `/api/actions/[actionId]/evidence`). No new aggregate math beyond what `computeOutcomesSummary` already does — explicitly no summing of overlapping per-action deltas into a "sitewide growth" figure (brief's own ban), no fabricated confidence interval. Time-trend chart only if ≥2 distinct `outcomeMeasuredAt` dates exist across the customer's actions; otherwise a plain before/after comparison bar per the brief's fallback instruction.

## Distribution

Not implemented (no existing screen to align, per brief's own instruction to skip if absent). No placeholder tab added.

## Motion, states, responsive

Standard for this codebase already (`useReducedMotion` gating, 150-300ms durations, `pointer: coarse` disabling non-essential hover-driven effects) — extended to all new/restyled components, no new animation library. Every changed component gets loading/empty/populated/error states; error/retry reuses existing patterns already present in `LiveScanPanel`'s polling logic. 44px minimum touch target enforced on all interactive controls in the Review Queue and utility bar (existing `Button` component's default height already meets this; verified during implementation, not assumed).

## Acceptance gate

Per the brief's own list, checked by the independent gatekeeper subagent at the early-prototype stage (Overview tab only) and again at the end (all four tabs): site/action/freshness legible at a glance, real flows only, correct metric labels/periods, 390/768/1440px widths, keyboard/focus/contrast/reduced-motion, no console/hydration errors, no fabricated charts or claims, existing tests/typecheck/build green, performance compared against the pre-change baseline.
