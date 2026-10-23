# Dashboard v2 — Design

## Problem

The dashboard (`src/app/dashboard/page.tsx`) is a single long-scroll page: one fixed 14-day activity chart, three stat cards locked to "vs last week," a ProofLayer breakdown donut, and the live scan panel. It works, but: numbers only, no narrative; no way to look at a different time window; and the GSC outcome data from Phase 5 (baseline/outcome/delta per action) is invisible anywhere except one action at a time on its own review page — there's no aggregate view of whether Dex's changes are actually working.

## Scope (confirmed with the founder)

- **In scope:** an AI-generated plain-English insight summary, a ProofLayer pass-rate-vs-target chart, a date-range selector (7/14/30/90 days), an aggregate Outcomes view surfacing the Phase 5 GSC data, a tabbed layout (Overview / Analytics / Review Queue / Outcomes) replacing the single scroll, and a MagicUI-based visual pass (animated stat counters, hover-elevated cards, a subtle live-scan indicator) plus general Apple-style restraint (tighter type scale, calmer motion).
- **Explicitly out of scope:** multi-site/team support (a real data-model and auth change — `Customer` is 1:1 with a site everywhere in the codebase; this is its own future project, not a dashboard visual pass) and anything requiring a new backend integration beyond what Phases 1-5 already built.
- **Component library:** MagicUI, added via its own official MCP server (`.mcp.json`, project-scoped) and CLI — used sparingly and functionally (`NumberTicker` for animated stat values, `MagicCard` for hover elevation, `BorderBeam` only as a "scan in progress" indicator). Explicitly skipping MagicUI's marketing-flavored pieces (Particles, Confetti, Globe, Meteors) — wrong register for a daily-use ops dashboard.

## Architecture

Four additions on top of the existing dashboard, all reading data that already exists (Actions, ScanJobs, and Phase 5's baseline/outcome fields) — no new tables:

1. **Tabs shell.** `src/app/dashboard/page.tsx` stays a Server Component and fetches everything up front (as it does today, just with a wider `Action` query needed for Outcomes). A new client component `DashboardTabs` (shadcn `Tabs`, URL-synced via `?tab=`) renders four panels, each receiving pre-fetched server data as props — no client-side data fetching, no new API routes.
2. **Date range.** A `range` search param (`7 | 14 | 30 | 90`, default `14`) read server-side in `page.tsx`, driving every day-bucketed series (`computeActivitySeries`, `computeGuardCatchSeries`, `computeTokenSeries` already take a `days` parameter — this just threads a variable value instead of the hardcoded `14`). A client `DateRangeSelect` (shadcn `Select`) navigates via `router.push` with the new param, preserving the active tab.
3. **AI Insight card.** New `src/lib/dashboard-insight.ts`, same `OpenAICaller`-injectable pattern as `creation-engine.ts`'s `draftMetaDescription`, takes the already-computed stats/deltas and returns one or two plain-English sentences. Rendered in a new `AiInsightCard`, labeled "AI summary" per the AI-disclosure guideline already applied elsewhere in this app (ProofLayer's own `aiDisclosure` field).
4. **Outcomes aggregate.** A new `computeOutcomesSummary` in `dashboard-stats.ts`, folding over actions that have `outcomeMeasuredAt` set: count measured, count with a positive click delta ("win rate"), and summed impressions/clicks deltas. Rendered in a new `OutcomesSummary` component on the Outcomes tab.

## Data model

No schema changes. The Outcomes aggregate needs `baselinePerformance`/`outcomePerformance`/`outcomeMeasuredAt` on `Action` — already added in Phase 5 — so `page.tsx`'s existing `db.action.findMany` for stats just needs those three fields added to its `select`.

## `dashboard-stats.ts` additions

```typescript
export interface OutcomesSummary {
  measuredCount: number;
  winCount: number; // outcome clicks > baseline clicks
  totalImpressionsDelta: number;
  totalClicksDelta: number;
}

export function computeOutcomesSummary(
  actions: {
    outcomeMeasuredAt: Date | null;
    baselinePerformance: unknown;
    outcomePerformance: unknown;
  }[]
): OutcomesSummary {
  // filters to actions with all three of outcomeMeasuredAt/baselinePerformance/outcomePerformance set,
  // sums (outcome.clicks - baseline.clicks) and (outcome.impressions - baseline.impressions),
  // counts wins as clicks delta > 0
}

export interface PassRateTarget {
  passRate: number; // 0-100
  target: number; // 90, fixed for v1 — not user-configurable yet
}

export function computePassRate(guardCounts: GuardCounts): PassRateTarget {
  const total = guardCounts.pass + guardCounts.flag + guardCounts.block;
  const passRate = total === 0 ? 100 : Math.round((guardCounts.pass / total) * 100);
  return { passRate, target: 90 };
}
```

(Exact implementation bodies are in the plan, not repeated here — this section fixes the public interface so later tasks can build against it without waiting.)

## AI Insight

```typescript
// src/lib/dashboard-insight.ts
export interface DashboardInsightInput {
  pagesScanned: number;
  guardCatches: number;
  guardCatchesDelta: number | null;
  pendingCount: number;
  rangeDays: number;
}

type OpenAICaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

export async function generateDashboardInsight(
  input: DashboardInsightInput,
  callOpenAI?: OpenAICaller
): Promise<string>;
```

Same model, same timeout/retry posture as `creation-engine.ts`'s `defaultCaller` (`openai/gpt-oss-120b`, 15s timeout, 1 retry) — this is a summary, not a customer-facing draft, so no `tokenCost` tracking is needed (it's an internal dashboard aid, not billed to a `draftMetaDescription`-style Action). On any OpenAI failure, `AiInsightCard` falls back to a plain, code-generated sentence built from the same stats (e.g., "`{guardCatches} pages flagged this {rangeDays}-day window.`") rather than showing an error or nothing — the card must never be empty or broken-looking.

## Tabs

`DashboardTabs` (client component) takes four pre-rendered `ReactNode` props (`overview`, `analytics`, `reviewQueue`, `outcomes`) from the server-rendered `page.tsx` and switches visibility via shadcn `Tabs`, syncing the active tab to `?tab=` so it survives a reload/share. Content:

- **Overview** (default): today's `ScanHealthCard` + 3 `StatCard`s + `ComparisonBar` + `GuardBreakdown`, unchanged logic, `AiInsightCard` added above them.
- **Analytics**: the existing mini-bar-chart trend data, now driven by the selected date range, plus the new `PassRateBullet`.
- **Review Queue**: `LiveScanPanel`, unchanged (it already fetches its own live updates).
- **Outcomes**: new `OutcomesSummary` card.

## MagicUI components

Added via the project-scoped MCP server (already registered in `.mcp.json`) and/or `npx @magicuidesign/cli@latest add <component>`:

- `number-ticker` — wraps each `StatCard`'s numeric value so it animates up from 0 on mount (respecting `prefers-reduced-motion`, matching every other animated component in this codebase).
- `magic-card` — replaces the plain `Card` wrapper in `StatCard` for a subtle hover-elevation/glow, not a spotlight-follows-cursor effect (too busy for a dense grid of cards).
- `border-beam` — added only to `LiveScanPanel`'s container, only while a scan job's status is `running`, as the "this is live" affordance the plain badge doesn't give today.

## Visual polish (Apple-restraint pass)

Applied across touched components, not as a separate redesign: tighten card padding on the new tab-scoped layout, keep all durations in the existing 150-300ms range already used by `Reveal`/`Hero`, no new colors beyond the existing `--dex-*` and `--dex-app-*` tokens.

## Testing

- `computeOutcomesSummary`, `computePassRate`: pure functions, unit-tested with constructed `Action`-shaped fixtures (mirroring the existing `computeDashboardStats`/`computeGuardBreakdown` test style).
- `generateDashboardInsight`: unit-tested with an injected mock `OpenAICaller` (same pattern as `creation-engine.test.ts`), plus a test asserting the fallback sentence when the caller throws.
- `DashboardTabs`, `DateRangeSelect`: no dedicated component tests (matches this codebase's existing convention — no `*.test.tsx` files exist for any client component; `vitest.config.ts` runs in `node` environment). Correctness verified via `npm test` (nothing broken) + `tsc --noEmit` + a manual browser check (dev server, `browse` skill) confirming tabs switch, the range selector updates the URL and the charts, and the AI insight card renders.
- `page.tsx`'s wider `Action` select: no new test needed (it's a Server Component with no dedicated test file today, matching existing convention).

## Out of scope (deferred)

- Multi-site/team support (separate project, per the Scope section above).
- User-configurable pass-rate target (fixed at 90% for v1).
- A calendar-based custom date range (a discrete 7/14/30/90 selector matches the plan's YAGNI convention — no calendar widget needed yet).
- Any change to `/review/[actionId]` (the diff/undo/evidence-pack UI from Phase 3/5 stays exactly as shipped — this project only touches the dashboard).
