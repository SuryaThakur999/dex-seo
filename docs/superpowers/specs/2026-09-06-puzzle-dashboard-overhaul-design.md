# Puzzle-style dashboard overhaul — design

## Problem

The dex-ai dashboard (shipped in `2026-09-04-dashboard-rebuild.md`) has a dark
coral/amber theme, real Recharts data, and an icon-rail sidebar — but its stat
cards are static: a label, a number, a hint. No trend, no comparison, no
freshness signal. `formatRelativeTime()` exists in `lib/dashboard-stats.ts`
and is unused.

## Reference

User pointed at puzzle.io (accounting SaaS) and puzzle.io/see-puzzle. Studied
via live screenshot at 2x scale. Puzzle's dashboard mock shows:

- **Cash**: big number + green `+10%` delta badge + "Updated 2 min ago" +
  inline sparkline.
- **Net Burn — 3 month average**: number + delta + "Estimated" badge +
  inline vertical bar chart (purple bars, varying height).
- **Spend**: number + delta + small multi-bar chart, one bar per day.
- **Net Burn MoM**: number + delta + horizontal two-segment comparison bar
  (current period vs previous period) with a dot legend below.

Explicitly not cloned: Puzzle's light theme and purple/lavender palette. Its
icon-rail sidebar is structurally identical to what dex-ai already shipped
(icons only, no labels, logo mark at top) — no change needed there. What
transfers is the **card anatomy** (delta badge + freshness caption + inline
chart) and the **comparison-bar pattern**, not the color system.

## Brand decision

No new tokens, no new palette, no new npm dependency. Everything renders in
the existing `.dex-app` scope: coral `#FF4D2E` (primary), amber `#FFB020`
(secondary), `--dex-app-success` (green, positive delta), `--dex-app-danger`
(red, negative delta). Checked for a count-up/number-animation library that
might read as more polished — decided against it; the existing
`animate-stat-card-in` keyframe already covers stagger-in motion, and Apple
HIG favors restraint over gratuitous motion for data-dense screens.

## Data (all real, no fabrication)

`actions` are already fetched with `createdAt` selected
(`src/app/dashboard/page.tsx:39-42`) — no new Prisma query shape needed for
period comparisons, only new pure functions over data already in memory.
`recentJobs` currently takes 5 — enough for a job-over-job pages-scanned
delta (last two *completed* jobs).

New functions in `lib/dashboard-stats.ts`:

- `computeDelta(current: number, previous: number): number | null` — percent
  change; `null` when there's no prior-period data (renders no badge, not a
  fake `0%`).
- `splitByPeriod<T extends { createdAt: Date }>(items, days, now)` — generic
  current-window / previous-window splitter, used for the WoW comparison and
  for feeding delta inputs.
- `computeGuardCatchSeries(actions, days)` — daily-bucketed flag+block counts
  (refactors the bucketing loop already in `computeActivitySeries` into a
  shared helper so both functions share one bucketing implementation).
- `computeTokenSeries(actions, days)` — daily-bucketed `tokenCost` sums.
- `computeJobDelta(jobs: ScanJob[])` — percent change in `pagesScanned`
  between the last two *completed* jobs, reading `resultSummary` via the
  existing `parseScanResultSummary`.

## Components

- **`StatCard` → `MetricCard`** (same file, extended props, not a rename of
  the export — existing callers with no `delta`/`updatedAt`/`chart` props
  keep working unchanged): adds an optional delta pill (▲ green / ▼ red,
  10%-opacity tint background) next to the value, an optional "Updated Xm
  ago" caption via `formatRelativeTime`, and an optional `chart` slot
  (`ReactNode`) rendered below the hint.
- **`Sparkline`** (new, extracted from `ScanHealthCard`'s inline
  `AreaChart` — behavior unchanged, just made reusable) — used inside
  `ScanHealthCard` (as today) and inside the new Pages Scanned `MetricCard`.
- **`MiniBarChart`** (new) — small Recharts `BarChart`, coral bars, no axes,
  used for GrowthGuard catches/day and Tokens spent/day inside `MetricCard`.
- **`ComparisonBar`** (new) — two horizontal segments (current period width,
  previous period width, both scaled to the larger of the two) plus a
  dot-legend row ("This week" / "Last week"). Used once, for GrowthGuard
  catches WoW — the flagship trust metric, standing in for Puzzle's Net Burn
  MoM.

## Layout (`dashboard/page.tsx`)

1. Hero `ScanHealthCard` — unchanged position, gains a delta badge (pages
   scanned vs previous completed job) and an "Updated Xm ago" caption from
   `latestScanJob.completedAt`.
2. 2×2 metric grid (replaces the current 3-card row + separate
   `ActivityChart` card):
   - Pages Scanned — `MetricCard` + `Sparkline` (daily scan counts, existing
     `activitySeries.scans`)
   - GrowthGuard catches — `MetricCard` + `MiniBarChart` (daily flag+block
     counts, `computeGuardCatchSeries`)
   - Tokens spent — `MetricCard` + `MiniBarChart` (daily token cost,
     `computeTokenSeries`)
   - GrowthGuard catches, WoW — `ComparisonBar`
3. `GuardBreakdown` donut + `LiveScanPanel` — unchanged, unmoved. Categorical
   pass/flag/block breakdown has no Puzzle analog and stays as-is.

`ActivityChart` (the current full-width 14-day area chart) is superseded by
the 2×2 grid's per-metric charts and removed from `page.tsx`; the component
file itself is left in place (still exported, in case another view wants a
combined view) but no longer imported there.

## Testing

Existing `dashboard-stats.test.ts` gets new cases: `computeDelta` (positive,
negative, zero-previous → `null`), `splitByPeriod` (boundary dates),
`computeGuardCatchSeries`/`computeTokenSeries` (bucket totals sum to input),
`computeJobDelta` (two completed jobs, fewer than two jobs → `null`).
Component-level: manual visual verification via a temporary preview route
(same pattern as `critique-preview-temp` from the previous rebuild) before
wiring into the real authenticated page.
