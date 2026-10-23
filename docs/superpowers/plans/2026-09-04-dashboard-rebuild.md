# Dashboard Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current generic light-theme shadcn `/dashboard` with a professional, dark, functionally-real dashboard on Dex's own coral/amber brand, with real time-series and breakdown charts, matching the Yoki fintech dashboard's density and polish without copying its purple palette or its layout verbatim.

**Architecture:** A new `.dex-app` CSS scope (dark, coral/amber, sibling to the marketing site's `.dex-marketing` scope) overrides shadcn's standard variable names (`--background`, `--card`, `--accent`, etc.) so the existing var-driven `Card`/`Button` primitives re-theme with zero prop changes. A new `src/app/dashboard/layout.tsx` applies the scope and adds an icon-rail sidebar. Two new chart components (shadcn's official `chart` primitive, built on Recharts) replace the flat stat grid and the plain progress-bar guard breakdown. All chart data comes from a new `computeActivitySeries` function reading real `Action`/`ScanJob` rows, never fabricated.

**Tech Stack:** Next.js 14 App Router, Tailwind v4, shadcn/ui (`new-york` style, already configured), shadcn `chart` component (Recharts under the hood), `@phosphor-icons/react`, Prisma/Postgres.

## Global Constraints

- No AI-purple, no generic blue as the accent. Use `--dex-accent: #FF4D2E` (coral) and `--dex-accent-secondary: #FFB020` (amber), the same values already defined in `.dex-marketing` in `src/app/globals.css:64-74`.
- One icon family: `@phosphor-icons/react`, `weight="regular"` unless a component already sets another weight. Replace every `lucide-react` import in touched files.
- No fabricated numbers. Every chart value and stat card value must trace to a real Prisma query.
- No em-dashes, no banned AI-slop words, in any copy this plan adds (per this project's global no-ai-slop mandatory rule).
- Scope is `/dashboard` only. `/review` and `/settings` stay on the current light theme; do not touch `src/app/review/page.tsx` or `src/app/settings/page.tsx` in this plan.
- Preserve `LiveScanPanel`'s polling logic (`src/components/dashboard/live-scan-panel.tsx:1-105`) exactly: 3s interval, `MAX_POLL_TICKS` ceiling, visibility-state check, error/timeout messages. Visual-only changes there.
- Preserve the gating flow in `src/app/dashboard/page.tsx:16-171` (GSC-not-connected → site-not-selected → no-scans-yet → full dashboard) exactly. Restyle, don't rewrite the branching.

---

### Task 1: `.dex-app` design token scope

**Files:**
- Modify: `src/app/globals.css` (add new block after the existing `.dex-marketing` block, which ends around line 92)

**Interfaces:**
- Produces: a `.dex-app` class that, when applied to a DOM ancestor, overrides `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--border`, `--input`, `--ring`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground` to dark/coral values. Any existing var-driven component (`Card`, `Button`, form inputs) placed inside `.dex-app` re-themes automatically, no prop changes needed.

- [ ] **Step 1: Add the `.dex-app` block**

Insert this immediately after the existing `.dex-marketing { ... }` block (the one starting `--dex-bg: #0b0b0f;` around line 64) and before the reduced-motion media query that follows it:

```css
.dex-app {
  --background: #0b0b0f;
  --foreground: #f4f4f6;
  --card: #15151b;
  --card-foreground: #f4f4f6;
  --popover: #15151b;
  --popover-foreground: #f4f4f6;
  --border: #232329;
  --input: #232329;
  --ring: #ff4d2e;
  --primary: #f4f4f6;
  --primary-foreground: #0b0b0f;
  --muted: #1d1d24;
  --muted-foreground: #9a9aa5;
  --accent: #ff4d2e;
  --accent-foreground: #ffffff;
  --destructive: #dc2626;
  --destructive-foreground: #ffffff;

  --dex-app-bg-elevated-2: #1d1d24;
  --dex-app-amber: #ffb020;
  --dex-app-success: #10b981;
  --dex-app-success-bg: rgba(16, 185, 129, 0.12);
  --dex-app-warning: #ffb020;
  --dex-app-warning-bg: rgba(255, 176, 32, 0.12);
  --dex-app-danger: #f87171;
  --dex-app-danger-bg: rgba(248, 113, 113, 0.12);
}

@media (prefers-reduced-motion: reduce) {
  .dex-app *,
  .dex-app *::before,
  .dex-app *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Verify the tokens parse**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -i "error\|css"`
Expected: build completes, no CSS parse errors mentioned.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add .dex-app dark token scope for the authenticated dashboard"
```

---

### Task 2: `computeActivitySeries` data function

**Files:**
- Modify: `src/lib/dashboard-stats.ts` (add new function and type after `computeGuardBreakdown`, around line 46)
- Test: `src/lib/dashboard-stats.test.ts` (add new `describe` block after the existing `computeGuardBreakdown` block, around line 35)

**Interfaces:**
- Consumes: an array of `{ createdAt: Date }`-shaped objects for scans, and `{ createdAt: Date }`-shaped objects for drafted actions (both already available from the existing `db.scanJob.findMany` / `db.action.findMany` calls in `src/app/dashboard/page.tsx:34-41`, just need `createdAt` added to the `select` there in Task 8).
- Produces: `computeActivitySeries(scans: { createdAt: Date }[], actions: { createdAt: Date }[], days: number): ActivityDay[]` where `ActivityDay = { date: string; scans: number; drafts: number }`, `date` formatted `YYYY-MM-DD`, one entry per day for the last `days` days ending today (UTC), oldest first, zero-filled for days with no activity.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/dashboard-stats.test.ts`:

```ts
describe('computeActivitySeries', () => {
  it('buckets scans and actions by day, zero-filled, oldest first', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const scans = [
      { createdAt: new Date('2026-09-04T09:00:00.000Z') },
      { createdAt: new Date('2026-09-02T09:00:00.000Z') },
    ];
    const actions = [
      { createdAt: new Date('2026-09-04T10:00:00.000Z') },
      { createdAt: new Date('2026-09-04T11:00:00.000Z') },
    ];
    const series = computeActivitySeries(scans, actions, 3, today);
    expect(series).toEqual([
      { date: '2026-09-02', scans: 1, drafts: 0 },
      { date: '2026-09-03', scans: 0, drafts: 0 },
      { date: '2026-09-04', scans: 1, drafts: 2 },
    ]);
  });

  it('returns an all-zero series when there is no activity', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const series = computeActivitySeries([], [], 2, today);
    expect(series).toEqual([
      { date: '2026-09-03', scans: 0, drafts: 0 },
      { date: '2026-09-04', scans: 0, drafts: 0 },
    ]);
  });
});
```

Also update the import line at the top of the test file to include `computeActivitySeries`:

```ts
import { computeDashboardStats, computeGuardBreakdown, computeActivitySeries, parseScanResultSummary, formatRelativeTime } from './dashboard-stats';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dashboard-stats.test.ts`
Expected: FAIL with `computeActivitySeries is not a function` or similar.

- [ ] **Step 3: Implement `computeActivitySeries`**

Add to `src/lib/dashboard-stats.ts`, after `computeGuardBreakdown`:

```ts
export interface ActivityDay {
  date: string;
  scans: number;
  drafts: number;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeActivitySeries(
  scans: { createdAt: Date }[],
  actions: { createdAt: Date }[],
  days: number,
  now: Date = new Date()
): ActivityDay[] {
  const buckets = new Map<string, ActivityDay>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = toDateKey(d);
    buckets.set(key, { date: key, scans: 0, drafts: 0 });
  }

  for (const scan of scans) {
    const key = toDateKey(scan.createdAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.scans += 1;
  }
  for (const action of actions) {
    const key = toDateKey(action.createdAt);
    const bucket = buckets.get(key);
    if (bucket) bucket.drafts += 1;
  }

  return Array.from(buckets.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/dashboard-stats.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-stats.ts src/lib/dashboard-stats.test.ts
git commit -m "feat: add computeActivitySeries for dashboard activity chart"
```

---

### Task 3: Install shadcn chart component

**Files:**
- Create: `src/components/ui/chart.tsx` (generated by the shadcn CLI, do not hand-write)

**Interfaces:**
- Produces: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `type ChartConfig` exported from `@/components/ui/chart`, used by Tasks 4 and 5. Also installs `recharts` as a dependency.

- [ ] **Step 1: Run the install command**

Run: `npx shadcn@latest add chart --yes`
Expected: creates `src/components/ui/chart.tsx`, adds `recharts` to `package.json`.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from `chart.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/chart.tsx package.json package-lock.json
git commit -m "feat: install shadcn chart component (Recharts)"
```

---

### Task 4: `ActivityChart` component (real time-series area chart)

**Files:**
- Create: `src/components/dashboard/activity-chart.tsx`

**Interfaces:**
- Consumes: `ActivityDay[]` from Task 2 (`{ date, scans, drafts }`), and `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`type ChartConfig` from `@/components/ui/chart` (Task 3).
- Produces: `ActivityChart({ data }: { data: ActivityDay[] })`, a stacked area chart, scans in `--dex-accent` (coral), drafts in `--dex-app-amber`, rendered inside a `Card`.

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { ActivityDay } from '@/lib/dashboard-stats';

const chartConfig: ChartConfig = {
  scans: { label: 'Scans', color: 'var(--dex-accent, #ff4d2e)' },
  drafts: { label: 'Drafts', color: 'var(--dex-app-amber, #ffb020)' },
};

export function ActivityChart({ data }: { data: ActivityDay[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Activity, last 14 days</CardTitle>
      </CardHeader>
      <CardContent className="pl-0">
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <AreaChart data={data} margin={{ left: 12, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
            <Area
              dataKey="scans"
              type="monotone"
              fill="var(--dex-accent, #ff4d2e)"
              fillOpacity={0.15}
              stroke="var(--dex-accent, #ff4d2e)"
              strokeWidth={2}
              stackId="a"
            />
            <Area
              dataKey="drafts"
              type="monotone"
              fill="var(--dex-app-amber, #ffb020)"
              fillOpacity={0.15}
              stroke="var(--dex-app-amber, #ffb020)"
              strokeWidth={2}
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/activity-chart.tsx
git commit -m "feat: add ActivityChart component for real scan/draft time series"
```

---

### Task 5: Rebuild `GuardBreakdown` as a donut chart

**Files:**
- Modify: `src/components/dashboard/guard-breakdown.tsx` (full rewrite of the render body, keep the `GuardCounts` prop interface unchanged)

**Interfaces:**
- Consumes: `GuardCounts` (unchanged, from `src/lib/dashboard-stats.ts`), `ChartContainer`/`ChartTooltip`/`ChartTooltipContent`/`type ChartConfig` from `@/components/ui/chart`.
- Produces: same exported `GuardBreakdown({ counts }: { counts: GuardCounts })` signature, so `src/app/dashboard/page.tsx:165` needs no change.

- [ ] **Step 1: Rewrite the component**

```tsx
'use client';

import Link from 'next/link';
import { Pie, PieChart, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { GuardCounts } from '@/lib/dashboard-stats';
import { OUTCOME_LABEL } from '@/lib/guard-outcome-ui';

const COLORS: Record<keyof GuardCounts, string> = {
  pass: 'var(--dex-app-success, #10b981)',
  flag: 'var(--dex-app-warning, #ffb020)',
  block: 'var(--dex-app-danger, #f87171)',
};

const chartConfig: ChartConfig = {
  pass: { label: OUTCOME_LABEL.pass, color: COLORS.pass },
  flag: { label: OUTCOME_LABEL.flag, color: COLORS.flag },
  block: { label: OUTCOME_LABEL.block, color: COLORS.block },
};

export function GuardBreakdown({ counts }: { counts: GuardCounts }) {
  const total = counts.pass + counts.flag + counts.block;
  const data = (Object.keys(counts) as (keyof GuardCounts)[]).map((key) => ({
    key,
    label: OUTCOME_LABEL[key],
    value: counts[key],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">GrowthGuard breakdown</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {total === 0 && (
          <p className="text-sm text-muted-foreground">No drafts checked yet. Run a scan to see GrowthGuard in action.</p>
        )}
        {total > 0 && (
          <div className="flex items-center gap-4">
            <ChartContainer config={chartConfig} className="h-[140px] w-[140px] shrink-0">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey="value" nameKey="label" innerRadius={40} outerRadius={64} strokeWidth={2}>
                  {data.map((entry) => (
                    <Cell key={entry.key} fill={COLORS[entry.key]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="flex flex-1 flex-col gap-2">
              {data.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[entry.key] }} />
                    {entry.label}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {entry.value} &middot; {total > 0 ? Math.round((entry.value / total) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Link href="/review" className="mt-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
          View review queue &rarr;
        </Link>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/guard-breakdown.tsx
git commit -m "feat: rebuild GuardBreakdown as a donut chart"
```

---

### Task 6: Redesign `StatCard` (dark, Phosphor icons)

**Files:**
- Modify: `src/components/dashboard/stat-card.tsx` (full rewrite)

**Interfaces:**
- Consumes: an icon component from `@phosphor-icons/react` instead of `LucideIcon`.
- Produces: same exported `StatCard` props shape (`label`, `value`, `hint?`, `icon`, `tone?`, `style?`), so `src/app/dashboard/page.tsx:132-160` needs no prop changes, only its own icon imports change (done in Task 9).

- [ ] **Step 1: Rewrite the component**

```tsx
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: PhosphorIcon;
  tone?: 'default' | 'accent';
  style?: React.CSSProperties;
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', style }: StatCardProps) {
  return (
    <Card className="animate-stat-card-in" style={style}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Icon size={16} weight="regular" className={cn(tone === 'accent' ? 'text-accent' : 'text-muted-foreground')} aria-hidden="true" />
        </div>
        <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors only in `src/app/dashboard/page.tsx` (still importing `lucide-react` icons), fixed in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/stat-card.tsx
git commit -m "feat: redesign StatCard for dark theme, drop mono/uppercase label, use Phosphor icons"
```

---

### Task 7: `ScanHealthCard` hero summary component

**Files:**
- Create: `src/components/dashboard/scan-health-card.tsx`

**Interfaces:**
- Consumes: `websiteUrl: string`, `pagesScanned: number`, `pendingCount: number`, `activity: ActivityDay[]` (last 14 days from Task 2), `gscConnected: boolean`.
- Produces: `ScanHealthCard(props)`, the large top-of-page card: site URL, a big "pages scanned" number, a compact sparkline (reusing the same `Area` chart pattern as Task 4 but smaller, coral only, no legend), and two small inline stat tiles (pending review, connection status) to the right, mirroring the Yoki reference's hero-card layout (`/Users/surya/yoki-fintech/static/images/dashboard-preview-fresh.jpg`) without copying its copy or its purple color.

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { Area, AreaChart } from 'recharts';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { ActivityDay } from '@/lib/dashboard-stats';

const chartConfig: ChartConfig = {
  scans: { label: 'Scans', color: 'var(--dex-accent, #ff4d2e)' },
};

export function ScanHealthCard({
  websiteUrl,
  pagesScanned,
  pendingCount,
  activity,
  gscConnected,
}: {
  websiteUrl: string;
  pagesScanned: number;
  pendingCount: number;
  activity: ActivityDay[];
  gscConnected: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-muted-foreground">{websiteUrl}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-foreground">{pagesScanned}</span>
            <span className="text-sm text-muted-foreground">pages scanned</span>
          </div>
          <div className="mt-4 h-16 w-full max-w-xs">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <AreaChart data={activity} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                <Area
                  dataKey="scans"
                  type="monotone"
                  fill="var(--dex-accent, #ff4d2e)"
                  fillOpacity={0.15}
                  stroke="var(--dex-accent, #ff4d2e)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
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

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/scan-health-card.tsx
git commit -m "feat: add ScanHealthCard hero summary component"
```

---

### Task 8: Restyle `ScanActivity` and `LiveScanPanel` (visual only, keep logic)

**Files:**
- Modify: `src/components/dashboard/scan-activity.tsx` (className changes only, keep all props/logic identical)
- Modify: `src/components/dashboard/live-scan-panel.tsx` (swap `lucide-react`'s `RefreshCw` for `@phosphor-icons/react`'s `ArrowsClockwise`, no logic changes)

**Interfaces:**
- No interface changes. `ScanActivityJob`, `LiveScanPanel({ initialJobs })` stay exactly as-is.

- [ ] **Step 1: Swap the icon import in `live-scan-panel.tsx`**

Change line 5 from:
```ts
import { RefreshCw } from 'lucide-react';
```
to:
```ts
import { ArrowsClockwise } from '@phosphor-icons/react';
```

And change the usage at line 97 from:
```tsx
<RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
```
to:
```tsx
<ArrowsClockwise size={16} weight="regular" className="mr-2" aria-hidden="true" />
```

- [ ] **Step 2: Restyle the status dot color in `scan-activity.tsx`**

Change line 54-55 (the running-status ping dot) from `bg-accent` to keep using `bg-accent` (it already resolves to the new dark coral via `.dex-app`, no change needed here since it's var-driven). Leave as-is; this file needs no changes given the `.dex-app` scope override handles the recolor automatically through the shared `Badge`/`bg-accent` tokens.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors, no remaining `lucide-react` import in `live-scan-panel.tsx`.

Run: `grep -rn "lucide-react" src/components/dashboard/`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/scan-activity.tsx src/components/dashboard/live-scan-panel.tsx
git commit -m "feat: swap LiveScanPanel icon to Phosphor, confirm ScanActivity themes via .dex-app tokens"
```

---

### Task 9: Dashboard layout shell (sidebar rail nav)

**Files:**
- Create: `src/app/dashboard/layout.tsx`

**Interfaces:**
- Produces: a layout component wrapping `src/app/dashboard/page.tsx`'s children in `<div className="dex-app dark min-h-screen bg-background">`, with a fixed left icon-rail sidebar (Home/Dashboard, Review queue, Settings, each a `Link` with a Phosphor icon and an active-state highlight) and the page content offset to the right of it.

- [ ] **Step 1: Write the layout**

```tsx
import Link from 'next/link';
import { SquaresFour, Inbox, Gear } from '@phosphor-icons/react/dist/ssr';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/review', label: 'Review queue', icon: Inbox },
  { href: '/settings', label: 'Settings', icon: Gear },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dex-app dark flex min-h-screen bg-background text-foreground">
      <aside className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-border py-6">
        <div className="mb-6 flex h-8 w-8 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
          D
        </div>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={item.label}
          >
            <item.icon size={20} weight="regular" aria-hidden="true" />
            <span className="sr-only">{item.label}</span>
          </Link>
        ))}
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/layout.tsx
git commit -m "feat: add dashboard layout shell with icon-rail sidebar nav"
```

---

### Task 10: Wire `src/app/dashboard/page.tsx` together

**Files:**
- Modify: `src/app/dashboard/page.tsx` (full rewrite of imports and the connected-with-scans branch; keep the gating logic identical)

**Interfaces:**
- Consumes: `ScanHealthCard` (Task 7), `ActivityChart` (Task 4), `StatCard` (Task 6, unchanged props), `GuardBreakdown` (Task 5, unchanged props), `LiveScanPanel` (Task 8, unchanged props), `computeActivitySeries` (Task 2).
- Produces: the rendered `/dashboard` page. No route or exported-function signature changes, this is a leaf page component.

- [ ] **Step 1: Update imports**

Replace the icon import line:
```ts
import { FileSearch, Inbox, ShieldCheck, Coins, Link2 } from 'lucide-react';
```
with:
```ts
import { FileSearch, ShieldCheck, Coins, Link } from '@phosphor-icons/react/dist/ssr';
```
(Note: `Link2` from lucide becomes phosphor's `Link` icon; `next/link`'s `Link` component import already exists at the top of the file, so alias the icon import to avoid a name collision: `import { FileSearch, ShieldCheck, Coins, Link as LinkIcon } from '@phosphor-icons/react/dist/ssr';` and use `<LinkIcon ... />` at the connect-GSC empty state.)

Add:
```ts
import { ScanHealthCard } from '@/components/dashboard/scan-health-card';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { computeActivitySeries } from '@/lib/dashboard-stats';
```

- [ ] **Step 2: Add `createdAt` to the actions query and compute the series**

In the existing `Promise.all` block (currently around line 34-42), add `createdAt: true` to the `select` on `db.action.findMany`:

```ts
const [recentJobs, actions] = siteSelected
  ? await Promise.all([
      db.scanJob.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
      db.action.findMany({
        where: { customerId: customer.id },
        select: { status: true, tokenCost: true, createdAt: true, guardResult: { select: { outcome: true } } },
      }),
    ])
  : [[], []];
```

After `const guardCounts = computeGuardBreakdown(actions);`, add:

```ts
const activitySeries = computeActivitySeries(recentJobs, actions, 14);
```

- [ ] **Step 3: Replace the connected-with-scans render block**

Replace the block currently at lines 129-168 (`{siteSelected && latestScanJob && ( ... )}`) with:

```tsx
{siteSelected && latestScanJob && (
  <>
    <div className="mt-8">
      <ScanHealthCard
        websiteUrl={customer.websiteUrl}
        pagesScanned={latestSummary?.pagesScanned ?? 0}
        pendingCount={stats.pendingCount}
        activity={activitySeries}
        gscConnected={gscConnected}
      />
    </div>

    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="GrowthGuard catches" value={String(stats.guardCatches)} hint="Flagged or blocked before reaching you" icon={ShieldCheck} style={{ animationDelay: '0ms' }} />
      <StatCard label="Tokens spent" value={stats.tokensSpent.toLocaleString()} hint="All-time" icon={Coins} style={{ animationDelay: '60ms' }} />
      <StatCard label="Pages scanned" value={String(latestSummary?.pagesScanned ?? 0)} hint="Last scan" icon={FileSearch} tone="accent" style={{ animationDelay: '120ms' }} />
    </div>

    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ActivityChart data={activitySeries} />
      <GuardBreakdown counts={guardCounts} />
    </div>

    <div className="mt-6">
      <LiveScanPanel initialJobs={recentJobs} />
    </div>
  </>
)}
```

Update the `Link2` usage in the not-connected empty state block (around line 74) to `<LinkIcon className="h-6 w-6 text-accent" aria-hidden="true" />`.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the two new `computeActivitySeries` tests from Task 2.

- [ ] **Step 6: Run the build**

Run: `npm run build`
Expected: clean build, no lint errors from `lucide-react` remaining in touched files.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: wire redesigned dashboard together with real activity chart data"
```

---

### Task 11: Visual verification and deploy

**Files:** none (verification-only task)

- [ ] **Step 1: Start the dev server and view the dashboard**

Since `/dashboard` requires Clerk auth, build a temporary local-only preview route (same pattern used earlier this session, e.g. `src/app/critique-preview-temp/page.tsx`, deleted after use, never committed) that renders `ScanHealthCard`, the `StatCard` grid, `ActivityChart`, and `GuardBreakdown` with realistic mock data, wrapped in the same `.dex-app dark` layout shell from Task 9. Screenshot via the gstack `/browse` skill at desktop width.

- [ ] **Step 2: Check for visual bugs**

Confirm: dark background renders (not the old light theme), coral/amber accent colors show correctly (not purple, not blue), both charts render with visible data, no layout overflow, sidebar nav icons visible and aligned.

- [ ] **Step 3: Delete the temp preview route**

```bash
rm -rf src/app/critique-preview-temp
git status --porcelain
```
Expected: clean, no untracked files.

- [ ] **Step 4: Deploy**

```bash
vercel --prod
```
Expected: `readyState: READY`.

---

## Fast-follow (out of scope for this plan)

Restyling `/review` and `/settings` to the same `.dex-app` dark theme, once this dashboard ships and the founder has used it live. Wrapping their layouts in `.dex-app` is the same one-line pattern as Task 9.
