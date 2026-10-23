# Puzzle-style dashboard overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give dex-ai's authenticated dashboard stat cards the anatomy Puzzle.io uses (delta badge, "Updated Xm ago" freshness caption, inline trend chart) plus a week-over-week comparison bar for GrowthGuard catches, without touching the existing dark coral/amber brand.

**Architecture:** Pure-function additions to `lib/dashboard-stats.ts` (period splitting, delta math, two new daily-bucket series) feed three new small presentational chart components (`Sparkline`, `MiniBarChart`, `ComparisonBar`) and an extended `StatCard`. `dashboard/page.tsx` (real, authenticated) and `dashboard-preview/page.tsx` (mock data, unauthenticated — the project's existing visual-verification route) are wired identically so the preview route stays a true mirror of production.

**Tech Stack:** Next.js App Router (server components), Recharts via the existing `components/ui/chart.tsx` wrapper, Phosphor icons, Vitest.

## Global Constraints

- No new npm dependency (spec: "Brand decision" — checked for a count-up library, decided against it).
- No new CSS tokens or palette — use only `--dex-accent` (#ff4d2e), `--dex-app-amber` (#ffb020), `--dex-app-success`/`--dex-app-success-bg`, `--dex-app-danger`/`--dex-app-danger-bg`, all already defined in `src/app/globals.css`.
- Every existing call site of `StatCard`/`ActivityChart` is `src/app/dashboard/page.tsx` and `src/app/dashboard-preview/page.tsx` only (verified by repo-wide grep) — both get updated together in Task 6.
- `StatCard`'s exported name and existing required props (`label`, `value`, `icon`) do not change — only new optional props are added, so any future caller with the old prop set keeps compiling.
- Icons: server-rendered components (`StatCard`, page files) import from `@phosphor-icons/react/dist/ssr`, matching the existing convention in `dashboard/page.tsx`. One documented exception to the prior "weight=regular default" migration rule: the delta arrows use `weight="bold"` because at 10px regular weight is illegible — this is a new use case that rule didn't cover.
- `recentJobs` in both page files is already ordered `createdAt: 'desc'` (see `db.scanJob.findMany` in `dashboard/page.tsx:38`) — `computeJobDelta` relies on that ordering and must not re-sort.

---

### Task 1: Data-layer functions — period splitting, delta math, daily series

**Files:**
- Modify: `src/lib/dashboard-stats.ts`
- Test: `src/lib/dashboard-stats.test.ts`

**Interfaces:**
- Produces: `computeDelta(current: number, previous: number): number | null`
- Produces: `splitByPeriod<T extends { createdAt: Date }>(items: T[], days: number, now?: Date): { current: T[]; previous: T[] }`
- Produces: `interface DailyCount { date: string; value: number }`
- Produces: `computeGuardCatchSeries(actions: { createdAt: Date; guardResult: { outcome: string } | null }[], days: number, now?: Date): DailyCount[]`
- Produces: `computeTokenSeries(actions: { createdAt: Date; tokenCost: number | null }[], days: number, now?: Date): DailyCount[]`
- Produces: `computeJobDelta(jobs: { status: string; resultSummary: unknown }[]): number | null` (assumes `jobs` ordered newest-first; consumes `parseScanResultSummary`, already defined in this file)
- Consumes: existing `toDateKey` (private helper already in this file, line 59) — refactored into a new private `dateKeysFor(days, now)` helper shared by `computeActivitySeries` and the two new series functions.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dashboard-stats.test.ts`:

```typescript
describe('computeDelta', () => {
  it('returns positive percent change', () => {
    expect(computeDelta(120, 100)).toBe(20);
  });

  it('returns negative percent change', () => {
    expect(computeDelta(80, 100)).toBe(-20);
  });

  it('returns null when previous is zero, regardless of current', () => {
    expect(computeDelta(10, 0)).toBeNull();
    expect(computeDelta(0, 0)).toBeNull();
  });
});

describe('splitByPeriod', () => {
  it('splits items into current window and the window before it, dropping anything older', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const items = [
      { id: 'a', createdAt: new Date('2026-09-06T00:00:00.000Z') }, // 0 days ago -> current
      { id: 'b', createdAt: new Date('2026-08-30T12:00:00.000Z') }, // 7 days ago -> boundary, previous
      { id: 'c', createdAt: new Date('2026-08-28T00:00:00.000Z') }, // 9 days ago -> previous
      { id: 'd', createdAt: new Date('2026-08-20T00:00:00.000Z') }, // 17 days ago -> dropped
    ];
    const result = splitByPeriod(items, 7, now);
    expect(result.current.map((i) => i.id)).toEqual(['a']);
    expect(result.previous.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('returns empty arrays for no items', () => {
    expect(splitByPeriod([], 7, new Date())).toEqual({ current: [], previous: [] });
  });
});

describe('computeGuardCatchSeries', () => {
  it('buckets flag+block outcomes by day and ignores pass', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const actions = [
      { createdAt: new Date('2026-09-04T09:00:00.000Z'), guardResult: { outcome: 'flag' } },
      { createdAt: new Date('2026-09-04T10:00:00.000Z'), guardResult: { outcome: 'block' } },
      { createdAt: new Date('2026-09-04T11:00:00.000Z'), guardResult: { outcome: 'pass' } },
      { createdAt: new Date('2026-09-03T09:00:00.000Z'), guardResult: { outcome: 'flag' } },
    ];
    expect(computeGuardCatchSeries(actions, 2, today)).toEqual([
      { date: '2026-09-03', value: 1 },
      { date: '2026-09-04', value: 2 },
    ]);
  });
});

describe('computeTokenSeries', () => {
  it('sums tokenCost by day, treating null as zero', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const actions = [
      { createdAt: new Date('2026-09-04T09:00:00.000Z'), tokenCost: 10 },
      { createdAt: new Date('2026-09-04T10:00:00.000Z'), tokenCost: 20 },
      { createdAt: new Date('2026-09-04T11:00:00.000Z'), tokenCost: null },
    ];
    expect(computeTokenSeries(actions, 1, today)).toEqual([{ date: '2026-09-04', value: 30 }]);
  });
});

describe('computeJobDelta', () => {
  it('computes percent change in pagesScanned between the two most recent completed jobs', () => {
    const jobs = [
      { status: 'completed', resultSummary: { pagesScanned: 12, pagesFlagged: 0, draftsCreated: 0, errors: [] } },
      { status: 'failed', resultSummary: null },
      { status: 'completed', resultSummary: { pagesScanned: 10, pagesFlagged: 0, draftsCreated: 0, errors: [] } },
    ];
    expect(computeJobDelta(jobs)).toBe(20);
  });

  it('returns null with fewer than two completed jobs', () => {
    expect(computeJobDelta([{ status: 'completed', resultSummary: { pagesScanned: 12, pagesFlagged: 0, draftsCreated: 0, errors: [] } }])).toBeNull();
    expect(computeJobDelta([])).toBeNull();
  });
});
```

Update the import line at the top of the test file to include the new names:

```typescript
import {
  computeDashboardStats,
  computeGuardBreakdown,
  computeActivitySeries,
  parseScanResultSummary,
  formatRelativeTime,
  computeDelta,
  splitByPeriod,
  computeGuardCatchSeries,
  computeTokenSeries,
  computeJobDelta,
} from './dashboard-stats';
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- dashboard-stats`
Expected: FAIL — `computeDelta is not a function` (and similarly for the other five new names)

- [ ] **Step 3: Implement**

In `src/lib/dashboard-stats.ts`, replace the existing `computeActivitySeries` function (and the `toDateKey` helper stays, but the bucket-date-array logic gets pulled into a new `dateKeysFor` helper) and append the new functions after it:

```typescript
function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateKeysFor(days: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(toDateKey(d));
  }
  return keys;
}

export function computeActivitySeries(
  scans: { createdAt: Date }[],
  actions: { createdAt: Date }[],
  days: number,
  now: Date = new Date()
): ActivityDay[] {
  const buckets = new Map<string, ActivityDay>();
  for (const key of dateKeysFor(days, now)) {
    buckets.set(key, { date: key, scans: 0, drafts: 0 });
  }

  for (const scan of scans) {
    const bucket = buckets.get(toDateKey(scan.createdAt));
    if (bucket) bucket.scans += 1;
  }
  for (const action of actions) {
    const bucket = buckets.get(toDateKey(action.createdAt));
    if (bucket) bucket.drafts += 1;
  }

  return Array.from(buckets.values());
}

export function computeDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function splitByPeriod<T extends { createdAt: Date }>(
  items: T[],
  days: number,
  now: Date = new Date()
): { current: T[]; previous: T[] } {
  const currentStart = now.getTime() - days * 86400000;
  const previousStart = now.getTime() - 2 * days * 86400000;

  const current: T[] = [];
  const previous: T[] = [];
  for (const item of items) {
    const t = item.createdAt.getTime();
    if (t > currentStart && t <= now.getTime()) {
      current.push(item);
    } else if (t > previousStart && t <= currentStart) {
      previous.push(item);
    }
  }
  return { current, previous };
}

export interface DailyCount {
  date: string;
  value: number;
}

export function computeGuardCatchSeries(
  actions: { createdAt: Date; guardResult: { outcome: string } | null }[],
  days: number,
  now: Date = new Date()
): DailyCount[] {
  const buckets = new Map<string, DailyCount>();
  for (const key of dateKeysFor(days, now)) {
    buckets.set(key, { date: key, value: 0 });
  }

  for (const action of actions) {
    const outcome = action.guardResult?.outcome;
    if (outcome !== 'flag' && outcome !== 'block') continue;
    const bucket = buckets.get(toDateKey(action.createdAt));
    if (bucket) bucket.value += 1;
  }

  return Array.from(buckets.values());
}

export function computeTokenSeries(
  actions: { createdAt: Date; tokenCost: number | null }[],
  days: number,
  now: Date = new Date()
): DailyCount[] {
  const buckets = new Map<string, DailyCount>();
  for (const key of dateKeysFor(days, now)) {
    buckets.set(key, { date: key, value: 0 });
  }

  for (const action of actions) {
    const bucket = buckets.get(toDateKey(action.createdAt));
    if (bucket) bucket.value += action.tokenCost ?? 0;
  }

  return Array.from(buckets.values());
}

export function computeJobDelta(jobs: { status: string; resultSummary: unknown }[]): number | null {
  const completed = jobs.filter((job) => job.status === 'completed').slice(0, 2);
  if (completed.length < 2) return null;

  const latest = parseScanResultSummary(completed[0].resultSummary);
  const prior = parseScanResultSummary(completed[1].resultSummary);
  if (!latest || !prior) return null;

  return computeDelta(latest.pagesScanned, prior.pagesScanned);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dashboard-stats`
Expected: PASS, all tests including the pre-existing ones in this file

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-stats.ts src/lib/dashboard-stats.test.ts
git commit -m "$(cat <<'EOF'
feat: add period-comparison data functions for dashboard metrics

computeDelta, splitByPeriod, computeGuardCatchSeries, computeTokenSeries,
and computeJobDelta give the dashboard the data it needs for delta badges
and a week-over-week comparison bar, modeled on Puzzle.io's card anatomy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 2: Sparkline component, extracted from ScanHealthCard

**Files:**
- Create: `src/components/dashboard/sparkline.tsx`
- Modify: `src/components/dashboard/scan-health-card.tsx`

**Interfaces:**
- Consumes: `ChartContainer`, `ChartConfig` from `@/components/ui/chart` (existing)
- Produces: `Sparkline({ data, dataKey, color }: { data: Record<string, unknown>[]; dataKey?: string; color?: string })` — a client component, default `dataKey="scans"`, default `color="var(--dex-accent, #ff4d2e)"`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Area, AreaChart } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

export function Sparkline({
  data,
  dataKey = 'scans',
  color = 'var(--dex-accent, #ff4d2e)',
}: {
  data: Record<string, unknown>[];
  dataKey?: string;
  color?: string;
}) {
  const chartConfig: ChartConfig = { [dataKey]: { label: dataKey, color } };

  return (
    <ChartContainer config={chartConfig} className="h-16 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <Area dataKey={dataKey} type="monotone" fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Use it inside ScanHealthCard, and add the delta + updatedAt props**

Replace the full contents of `src/components/dashboard/scan-health-card.tsx`:

```typescript
'use client';

import { CheckCircle, XCircle, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from '@/components/dashboard/sparkline';
import { formatRelativeTime, type ActivityDay } from '@/lib/dashboard-stats';
import { cn } from '@/lib/utils';

export function ScanHealthCard({
  websiteUrl,
  pagesScanned,
  pendingCount,
  activity,
  gscConnected,
  delta,
  updatedAt,
}: {
  websiteUrl: string;
  pagesScanned: number;
  pendingCount: number;
  activity: ActivityDay[];
  gscConnected: boolean;
  delta?: number | null;
  updatedAt?: Date | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-muted-foreground">{websiteUrl}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-foreground">{pagesScanned}</span>
            <span className="text-sm text-muted-foreground">pages scanned</span>
            {delta !== undefined && delta !== null && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
                  delta >= 0 ? 'text-[var(--dex-app-success)]' : 'text-[var(--dex-app-danger)]'
                )}
                style={{ backgroundColor: delta >= 0 ? 'var(--dex-app-success-bg)' : 'var(--dex-app-danger-bg)' }}
              >
                {delta >= 0 ? <ArrowUp size={10} weight="bold" /> : <ArrowDown size={10} weight="bold" />}
                {Math.abs(delta)}%
              </span>
            )}
          </div>
          {updatedAt && <p className="mt-0.5 text-xs text-muted-foreground">Updated {formatRelativeTime(updatedAt)}</p>}
          <div className="mt-4 w-full max-w-xs">
            <Sparkline data={activity} dataKey="scans" />
          </div>
        </div>

        <div className="flex gap-6 sm:flex-col sm:gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Pending review</span>
            <span className="text-lg font-semibold text-foreground">{pendingCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {gscConnected ? (
              <CheckCircle size={16} weight="fill" className="text-[var(--dex-app-success)]" aria-hidden="true" />
            ) : (
              <XCircle size={16} weight="fill" className="text-[var(--dex-app-danger)]" aria-hidden="true" />
            )}
            <span className="text-xs text-muted-foreground">
              {gscConnected ? 'Search Console connected' : 'Not connected'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

Note: `delta` and `updatedAt` are optional, so the current call sites in `dashboard/page.tsx` and `dashboard-preview/page.tsx` still compile unchanged until Task 6 updates them.

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (this task touches no tested function — `ScanHealthCard` and `Sparkline` have no unit tests per the spec's testing section; visual check happens in Task 7)

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/sparkline.tsx src/components/dashboard/scan-health-card.tsx
git commit -m "$(cat <<'EOF'
feat: extract Sparkline component, add delta badge to ScanHealthCard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 3: MiniBarChart component

**Files:**
- Create: `src/components/dashboard/mini-bar-chart.tsx`

**Interfaces:**
- Consumes: `ChartContainer`, `ChartConfig` from `@/components/ui/chart` (existing); `DailyCount` shape from Task 1 (`{ date: string; value: number }`) as the expected data shape, though the prop type stays the generic `Record<string, unknown>[]` `Sparkline` already uses, for consistency
- Produces: `MiniBarChart({ data, dataKey, color }: { data: Record<string, unknown>[]; dataKey?: string; color?: string })` — client component, default `dataKey="value"`, default `color="var(--dex-accent, #ff4d2e)"`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { Bar, BarChart } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

export function MiniBarChart({
  data,
  dataKey = 'value',
  color = 'var(--dex-accent, #ff4d2e)',
}: {
  data: Record<string, unknown>[];
  dataKey?: string;
  color?: string;
}) {
  const chartConfig: ChartConfig = { [dataKey]: { label: dataKey, color } };

  return (
    <ChartContainer config={chartConfig} className="h-16 w-full">
      <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: PASS (no unit test for this presentational component, per spec)

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/mini-bar-chart.tsx
git commit -m "$(cat <<'EOF'
feat: add MiniBarChart component for per-metric daily bars

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 4: ComparisonBar component

**Files:**
- Create: `src/components/dashboard/comparison-bar.tsx`

**Interfaces:**
- Consumes: `Card`, `CardContent` from `@/components/ui/card` (existing)
- Produces: `ComparisonBar({ label, current, previous, unit }: { label: string; current: number; previous: number; unit?: string })` — server component (no recharts, plain divs), `unit` defaults to `''`

- [ ] **Step 1: Create the component**

```typescript
import { Card, CardContent } from '@/components/ui/card';

export function ComparisonBar({
  label,
  current,
  previous,
  unit = '',
}: {
  label: string;
  current: number;
  previous: number;
  unit?: string;
}) {
  const max = Math.max(current, previous, 1);
  const currentPct = (current / max) * 100;
  const previousPct = (previous / max) * 100;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex flex-col gap-2">
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{ width: `${currentPct}%`, backgroundColor: 'var(--dex-accent, #ff4d2e)' }}
            />
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{ width: `${previousPct}%`, backgroundColor: 'var(--dex-app-amber, #ffb020)' }}
            />
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--dex-accent, #ff4d2e)' }} />
            This week: {current}{unit}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--dex-app-amber, #ffb020)' }} />
            Last week: {previous}{unit}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/comparison-bar.tsx
git commit -m "$(cat <<'EOF'
feat: add ComparisonBar component for week-over-week metrics

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 5: Extend StatCard with delta pill, updated caption, and chart slot

**Files:**
- Modify: `src/components/dashboard/stat-card.tsx`

**Interfaces:**
- Consumes: `formatRelativeTime` from `@/lib/dashboard-stats` (existing, Task 1 leaves it untouched)
- Produces: `StatCard` keeps its existing required props (`label`, `value`, `icon`) and existing optional props (`hint`, `tone`, `style`); adds optional `delta?: number | null`, `updatedAt?: Date | null`, `chart?: React.ReactNode`

- [ ] **Step 1: Replace the file contents**

```typescript
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ArrowUp, ArrowDown } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/dashboard-stats';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: PhosphorIcon;
  tone?: 'default' | 'accent';
  style?: React.CSSProperties;
  delta?: number | null;
  updatedAt?: Date | null;
  chart?: React.ReactNode;
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', style, delta, updatedAt, chart }: StatCardProps) {
  return (
    <Card className="animate-stat-card-in" style={style}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Icon size={16} weight="regular" className={cn(tone === 'accent' ? 'text-accent' : 'text-muted-foreground')} aria-hidden="true" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
          {delta !== undefined && delta !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
                delta >= 0 ? 'text-[var(--dex-app-success)]' : 'text-[var(--dex-app-danger)]'
              )}
              style={{ backgroundColor: delta >= 0 ? 'var(--dex-app-success-bg)' : 'var(--dex-app-danger-bg)' }}
            >
              {delta >= 0 ? <ArrowUp size={10} weight="bold" /> : <ArrowDown size={10} weight="bold" />}
              {Math.abs(delta)}%
            </span>
          )}
        </div>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {updatedAt && <span className="text-xs text-muted-foreground">Updated {formatRelativeTime(updatedAt)}</span>}
        {chart && <div className="mt-1">{chart}</div>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — this catches any prop-shape drift in the two page files, which still call `StatCard` with only the pre-existing props at this point (Task 6 adds the new ones)

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/stat-card.tsx
git commit -m "$(cat <<'EOF'
feat: add delta badge, updated caption, and chart slot to StatCard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 6: Wire the 2x2 metric grid into both page files

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard-preview/page.tsx`

**Interfaces:**
- Consumes: everything produced in Tasks 1-5 (`computeDelta`, `splitByPeriod`, `computeGuardCatchSeries`, `computeTokenSeries`, `computeJobDelta`, `Sparkline`, `MiniBarChart`, `ComparisonBar`, extended `StatCard`, extended `ScanHealthCard`)
- Produces: nothing new — this is the leaf wiring task

- [ ] **Step 1: Update `src/app/dashboard/page.tsx`**

Replace the import block (lines 1-16) with:

```typescript
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { FileMagnifyingGlass, ShieldCheck, Coins, Link as LinkIcon } from '@phosphor-icons/react/dist/ssr';
import { ensureCustomer, PENDING_WEBSITE_URL } from '@/lib/customer';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites } from '@/lib/gsc-client';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/dashboard/stat-card';
import { LiveScanPanel } from '@/components/dashboard/live-scan-panel';
import { GuardBreakdown } from '@/components/dashboard/guard-breakdown';
import { ScanHealthCard } from '@/components/dashboard/scan-health-card';
import { MiniBarChart } from '@/components/dashboard/mini-bar-chart';
import { ComparisonBar } from '@/components/dashboard/comparison-bar';
import {
  computeDashboardStats,
  computeGuardBreakdown,
  computeActivitySeries,
  computeGuardCatchSeries,
  computeTokenSeries,
  computeJobDelta,
  computeDelta,
  splitByPeriod,
  parseScanResultSummary,
} from '@/lib/dashboard-stats';
```

Replace the stats block (current lines 49-51: `const stats = ...` through `const activitySeries = ...`) with:

```typescript
  const stats = computeDashboardStats(actions);
  const guardCounts = computeGuardBreakdown(actions);
  const activitySeries = computeActivitySeries(recentJobs, actions, 14);
  const guardCatchSeries = computeGuardCatchSeries(actions, 14);
  const tokenSeries = computeTokenSeries(actions, 14);
  const pagesScannedDelta = computeJobDelta(recentJobs);
  const { current: currentWeekActions, previous: previousWeekActions } = splitByPeriod(actions, 7);
  const currentWeekStats = computeDashboardStats(currentWeekActions);
  const previousWeekStats = computeDashboardStats(previousWeekActions);
  const guardCatchesDelta = computeDelta(currentWeekStats.guardCatches, previousWeekStats.guardCatches);
  const tokensSpentDelta = computeDelta(currentWeekStats.tokensSpent, previousWeekStats.tokensSpent);
```

Replace the `ScanHealthCard` usage (current lines 134-142) with:

```typescript
          <div className="mt-8">
            <ScanHealthCard
              websiteUrl={customer.websiteUrl}
              pagesScanned={latestSummary?.pagesScanned ?? 0}
              pendingCount={stats.pendingCount}
              activity={activitySeries}
              gscConnected={gscConnected}
              delta={pagesScannedDelta}
              updatedAt={latestScanJob.completedAt}
            />
          </div>
```

Replace the stat-card grid and the `ActivityChart`/`GuardBreakdown` row (current lines 144-153) with:

```typescript
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Pages scanned"
              value={String(latestSummary?.pagesScanned ?? 0)}
              hint="Last scan"
              icon={FileMagnifyingGlass}
              tone="accent"
              delta={pagesScannedDelta}
              chart={<MiniBarChart data={activitySeries} dataKey="scans" />}
              style={{ animationDelay: '0ms' }}
            />
            <StatCard
              label="GrowthGuard catches"
              value={String(stats.guardCatches)}
              hint="Flagged or blocked before reaching you"
              icon={ShieldCheck}
              delta={guardCatchesDelta}
              chart={<MiniBarChart data={guardCatchSeries} dataKey="value" />}
              style={{ animationDelay: '60ms' }}
            />
            <StatCard
              label="Tokens spent"
              value={stats.tokensSpent.toLocaleString()}
              hint="All-time"
              icon={Coins}
              delta={tokensSpentDelta}
              chart={<MiniBarChart data={tokenSeries} dataKey="value" color="var(--dex-app-amber, #ffb020)" />}
              style={{ animationDelay: '120ms' }}
            />
            <ComparisonBar
              label="GrowthGuard catches, week over week"
              current={currentWeekStats.guardCatches}
              previous={previousWeekStats.guardCatches}
            />
          </div>

          <div className="mt-6">
            <GuardBreakdown counts={guardCounts} />
          </div>
```

Note: `latestScanJob.completedAt` is used directly (not `?.`) because this whole block is inside the `{siteSelected && latestScanJob && (...)}` guard already present in the file, so `latestScanJob` is non-null there; `completedAt` itself is still `Date | null` on the model, and `ScanHealthCard`'s `updatedAt` prop accepts `Date | null`.

- [ ] **Step 2: Update `src/app/dashboard-preview/page.tsx`** to mirror the same layout with mock data

Replace the full file contents:

```typescript
import { FileMagnifyingGlass, ShieldCheck, Coins } from '@phosphor-icons/react/dist/ssr';
import { StatCard } from '@/components/dashboard/stat-card';
import { LiveScanPanel } from '@/components/dashboard/live-scan-panel';
import { GuardBreakdown } from '@/components/dashboard/guard-breakdown';
import { ScanHealthCard } from '@/components/dashboard/scan-health-card';
import { MiniBarChart } from '@/components/dashboard/mini-bar-chart';
import { ComparisonBar } from '@/components/dashboard/comparison-bar';
import {
  computeActivitySeries,
  computeGuardCatchSeries,
  computeTokenSeries,
  computeJobDelta,
  computeDelta,
} from '@/lib/dashboard-stats';

export default function DashboardPreview() {
  const jobs = [
    {
      id: '1',
      status: 'completed',
      createdAt: new Date(Date.now() - 3 * 3600000),
      completedAt: new Date(Date.now() - 3 * 3600000),
      error: null,
      resultSummary: { pagesScanned: 41, pagesFlagged: 5, draftsCreated: 3, errors: [] },
    },
    { id: '2', status: 'failed', createdAt: new Date(Date.now() - 26 * 3600000), completedAt: new Date(Date.now() - 26 * 3600000), error: 'Scan timed out', resultSummary: null },
    {
      id: '3',
      status: 'completed',
      createdAt: new Date(Date.now() - 9 * 24 * 3600000),
      completedAt: new Date(Date.now() - 9 * 24 * 3600000),
      error: null,
      resultSummary: { pagesScanned: 37, pagesFlagged: 4, draftsCreated: 2, errors: [] },
    },
  ];

  const scans = Array.from({ length: 10 }, (_, i) => ({ createdAt: new Date(Date.now() - i * 26 * 3600000) }));
  const actions = Array.from({ length: 22 }, (_, i) => ({
    createdAt: new Date(Date.now() - i * 11 * 3600000),
    tokenCost: 40 + (i % 5) * 15,
    guardResult: { outcome: i % 6 === 0 ? 'block' : i % 3 === 0 ? 'flag' : 'pass' },
  }));

  const activitySeries = computeActivitySeries(scans, actions, 14);
  const guardCatchSeries = computeGuardCatchSeries(actions, 14);
  const tokenSeries = computeTokenSeries(actions, 14);
  const pagesScannedDelta = computeJobDelta(jobs);
  const currentWeekCatches = 3;
  const previousWeekCatches = 5;
  const guardCatchesDelta = computeDelta(currentWeekCatches, previousWeekCatches);
  const tokensSpentDelta = computeDelta(720, 640);

  return (
    <div className="dex-app dark min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          </div>
        </header>

        <div className="mt-8">
          <ScanHealthCard
            websiteUrl="getbetter.io"
            pagesScanned={41}
            pendingCount={6}
            activity={activitySeries}
            gscConnected={true}
            delta={pagesScannedDelta}
            updatedAt={jobs[0].completedAt}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Pages scanned"
            value="41"
            hint="Last scan"
            icon={FileMagnifyingGlass}
            tone="accent"
            delta={pagesScannedDelta}
            chart={<MiniBarChart data={activitySeries} dataKey="scans" />}
          />
          <StatCard
            label="GrowthGuard catches"
            value="3"
            hint="Flagged or blocked before reaching you"
            icon={ShieldCheck}
            delta={guardCatchesDelta}
            chart={<MiniBarChart data={guardCatchSeries} dataKey="value" />}
          />
          <StatCard
            label="Tokens spent"
            value="12,480"
            hint="All-time"
            icon={Coins}
            delta={tokensSpentDelta}
            chart={<MiniBarChart data={tokenSeries} dataKey="value" color="var(--dex-app-amber, #ffb020)" />}
          />
          <ComparisonBar label="GrowthGuard catches, week over week" current={currentWeekCatches} previous={previousWeekCatches} />
        </div>

        <div className="mt-6">
          <GuardBreakdown counts={{ pass: 28, flag: 5, block: 2 }} />
        </div>

        <div className="mt-6">
          <LiveScanPanel initialJobs={jobs} />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run the linter**

Run: `npm run lint`
Expected: PASS (fix any reported issues — e.g. unused `ActivityChart` import if one was missed)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard-preview/page.tsx
git commit -m "$(cat <<'EOF'
feat: wire Puzzle-style 2x2 metric grid into dashboard and preview

Replaces the flat 3-stat row plus separate ActivityChart card with four
metric cards (delta badge, inline chart) and a GrowthGuard week-over-week
comparison bar. GuardBreakdown and LiveScanPanel are unmoved.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 7: Visual verification against the Puzzle reference

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background — leave it running for this task)

- [ ] **Step 2: Screenshot the preview route with the browse skill**

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto "http://localhost:3000/dashboard-preview"
$B wait --networkidle
$B viewport 1000x1400 --scale 2
$B screenshot /tmp/dex-dashboard-after.png
```

- [ ] **Step 3: Compare against the reference and this session's captured Puzzle screenshot**

Read `/tmp/dex-dashboard-after.png` and compare side-by-side against the earlier-captured `dashboard-full.png` (Puzzle's mock) sitting in this session's scratchpad. Confirm: delta badges render with the correct color (green up / red down), "Updated Xm ago" caption is present on the hero card, all four grid cards render a chart in the same visual position, the comparison bar's two segments are visibly different widths and both legend dots are readable against the dark background. Fix any visual issue found directly in the relevant component file, then re-screenshot.

- [ ] **Step 4: Check both console and network for errors**

```bash
$B console --errors
$B network
```
Expected: no errors, no failed requests

- [ ] **Step 5: Stop the dev server**

Kill the background `npm run dev` process.

---

### Task 8: Final verification and deploy

**Files:** none (verification and deploy only)

- [ ] **Step 1: Full test suite, typecheck, lint, and build**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all four PASS

- [ ] **Step 2: Deploy**

There is no `deploy` script in `package.json`, but `.vercel/project.json` confirms this repo is already linked to the `dex-ai-plum` Vercel project and `vercel` is on `PATH`. Run:

```bash
vercel --prod
```

- [ ] **Step 3: Confirm production health**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dex-ai-plum.vercel.app/dashboard-preview
```
Expected: `200`

- [ ] **Step 4: Final commit if the deploy step produced any file changes (e.g. a lockfile touch)**

```bash
git status --short
```
If clean, no commit needed — Task 6's commit is the last code change.
