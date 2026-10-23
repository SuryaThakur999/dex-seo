# Dashboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard's single long scroll into a tabbed view with an AI-generated insight summary, a ProofLayer pass-rate-vs-target chart, a date-range selector, and an aggregate Outcomes view surfacing the Phase 5 GSC before/after data — plus a MagicUI-based visual pass.

**Architecture:** Full design in `docs/superpowers/specs/2026-09-08-dashboard-v2-design.md` — read that first. This plan is its executable task breakdown.

**Tech Stack:** Next.js 14, Prisma + PostgreSQL, Vitest, Recharts (already in use via `@/components/ui/chart`), shadcn/ui, MagicUI (new — via the project-scoped MCP server in `.mcp.json` and `npx @magicuidesign/cli@latest`).

## Global Constraints

Same as prior phases (test-per-change, no `git add -A`, commit convention ending in the Co-Authored-By/Claude-Session trailer, CLAUDE.md senior-developer + skill-routing rules). No schema changes — every new field this plan reads (`baselinePerformance`, `outcomePerformance`, `outcomeMeasuredAt`) already exists on `Action` from Phase 5. Motion durations stay in the existing 150-300ms range already used by `Reveal`/`Hero`/`StatCard`'s `animate-stat-card-in`; no new colors beyond the existing `--dex-*`/`--dex-app-*` CSS custom properties. `prefers-reduced-motion` must be respected by every new animated piece, matching every existing animated component in this codebase (`Reveal`, `Hero`, `SmoothScroll`, `Waves`).

---

### Task 1: `dashboard-stats.ts` — pass-rate and outcomes aggregate

**Files:**
- Modify: `src/lib/dashboard-stats.ts`
- Modify: `src/lib/dashboard-stats.test.ts`

**Interfaces:**
- Produces: `export interface PassRateTarget { passRate: number; target: number }` and `export function computePassRate(counts: GuardCounts): PassRateTarget`; `export interface OutcomesSummary { measuredCount: number; winCount: number; totalImpressionsDelta: number; totalClicksDelta: number }` and `export function computeOutcomesSummary(actions: { outcomeMeasuredAt: Date | null; baselinePerformance: unknown; outcomePerformance: unknown }[]): OutcomesSummary`. Task 5 (components) and Task 6 (page wiring) consume both.

- [ ] **Step 1: Write the failing tests**

Check whether `src/lib/dashboard-stats.test.ts` already exists (it may not — `dashboard-stats.ts` predates this plan and may only be covered by usage in other test files). If it doesn't exist, create it with these two `describe` blocks; if it exists, add these two blocks to it:

```typescript
import { describe, it, expect } from 'vitest';
import { computePassRate, computeOutcomesSummary } from './dashboard-stats';

describe('computePassRate', () => {
  it('computes the pass rate as a percentage of total checks', () => {
    expect(computePassRate({ pass: 18, flag: 1, block: 1 })).toEqual({ passRate: 90, target: 90 });
  });

  it('returns 100% when there are no checks yet', () => {
    expect(computePassRate({ pass: 0, flag: 0, block: 0 })).toEqual({ passRate: 100, target: 90 });
  });

  it('rounds to the nearest whole percent', () => {
    expect(computePassRate({ pass: 2, flag: 1, block: 0 })).toEqual({ passRate: 67, target: 90 });
  });
});

describe('computeOutcomesSummary', () => {
  it('ignores actions that have not been measured yet', () => {
    const actions = [
      { outcomeMeasuredAt: null, baselinePerformance: { impressions: 10, clicks: 1, ctr: 0.1 }, outcomePerformance: null },
    ];
    expect(computeOutcomesSummary(actions)).toEqual({
      measuredCount: 0,
      winCount: 0,
      totalImpressionsDelta: 0,
      totalClicksDelta: 0,
    });
  });

  it('aggregates deltas and counts wins across measured actions', () => {
    const actions = [
      {
        outcomeMeasuredAt: new Date('2026-02-01'),
        baselinePerformance: { impressions: 100, clicks: 5, ctr: 0.05 },
        outcomePerformance: { impressions: 150, clicks: 9, ctr: 0.06 },
      },
      {
        outcomeMeasuredAt: new Date('2026-02-02'),
        baselinePerformance: { impressions: 50, clicks: 4, ctr: 0.08 },
        outcomePerformance: { impressions: 40, clicks: 2, ctr: 0.05 },
      },
    ];
    expect(computeOutcomesSummary(actions)).toEqual({
      measuredCount: 2,
      winCount: 1,
      totalImpressionsDelta: 40,
      totalClicksDelta: 2,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/surya/Projects/dex-ai
npx vitest run src/lib/dashboard-stats.test.ts
```

Expected: FAIL — `computePassRate`/`computeOutcomesSummary` not exported yet.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/dashboard-stats.ts` (after `computeJobDelta`, at the end of the file):

```typescript
export interface PassRateTarget {
  passRate: number;
  target: number;
}

const PASS_RATE_TARGET = 90;

export function computePassRate(counts: GuardCounts): PassRateTarget {
  const total = counts.pass + counts.flag + counts.block;
  const passRate = total === 0 ? 100 : Math.round((counts.pass / total) * 100);
  return { passRate, target: PASS_RATE_TARGET };
}

export interface OutcomesSummary {
  measuredCount: number;
  winCount: number;
  totalImpressionsDelta: number;
  totalClicksDelta: number;
}

interface PerformanceSnapshot {
  impressions: number;
  clicks: number;
  ctr: number;
}

function asPerformanceSnapshot(value: unknown): PerformanceSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.impressions !== 'number' || typeof obj.clicks !== 'number') return null;
  return { impressions: obj.impressions, clicks: obj.clicks, ctr: typeof obj.ctr === 'number' ? obj.ctr : 0 };
}

export function computeOutcomesSummary(
  actions: { outcomeMeasuredAt: Date | null; baselinePerformance: unknown; outcomePerformance: unknown }[]
): OutcomesSummary {
  let measuredCount = 0;
  let winCount = 0;
  let totalImpressionsDelta = 0;
  let totalClicksDelta = 0;

  for (const action of actions) {
    if (!action.outcomeMeasuredAt) continue;
    const baseline = asPerformanceSnapshot(action.baselinePerformance);
    const outcome = asPerformanceSnapshot(action.outcomePerformance);
    if (!baseline || !outcome) continue;

    measuredCount += 1;
    const clicksDelta = outcome.clicks - baseline.clicks;
    const impressionsDelta = outcome.impressions - baseline.impressions;
    totalClicksDelta += clicksDelta;
    totalImpressionsDelta += impressionsDelta;
    if (clicksDelta > 0) winCount += 1;
  }

  return { measuredCount, winCount, totalImpressionsDelta, totalClicksDelta };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/dashboard-stats.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all 188 tests pass (183 existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard-stats.ts src/lib/dashboard-stats.test.ts
git commit -m "feat: add pass-rate and outcomes-summary aggregation to dashboard-stats

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 2: AI Insight generator + card

**Files:**
- Create: `src/lib/dashboard-insight.ts`
- Create: `src/lib/dashboard-insight.test.ts`
- Create: `src/components/dashboard/ai-insight-card.tsx`

**Interfaces:**
- Produces: `export interface DashboardInsightInput { pagesScanned: number; guardCatches: number; guardCatchesDelta: number | null; pendingCount: number; rangeDays: number }` and `export async function generateDashboardInsight(input: DashboardInsightInput, callOpenAI?: (prompt: string) => Promise<{ content: string; totalTokens: number }>): Promise<string>`. Task 6 (page wiring) calls `generateDashboardInsight` server-side and passes the resulting string into `AiInsightCard`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/dashboard-insight.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateDashboardInsight } from './dashboard-insight';

describe('generateDashboardInsight', () => {
  it('returns the OpenAI-generated summary on success', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'Scans are clean this week.', totalTokens: 42 });

    const result = await generateDashboardInsight(
      { pagesScanned: 41, guardCatches: 3, guardCatchesDelta: -40, pendingCount: 2, rangeDays: 14 },
      callOpenAI
    );

    expect(result).toBe('Scans are clean this week.');
    expect(callOpenAI).toHaveBeenCalledTimes(1);
    const prompt = callOpenAI.mock.calls[0][0] as string;
    expect(prompt).toContain('41');
    expect(prompt).toContain('3');
  });

  it('falls back to a plain generated sentence when OpenAI fails', async () => {
    const callOpenAI = vi.fn().mockRejectedValue(new Error('rate limited'));

    const result = await generateDashboardInsight(
      { pagesScanned: 41, guardCatches: 3, guardCatchesDelta: -40, pendingCount: 2, rangeDays: 14 },
      callOpenAI
    );

    expect(result).toBe('3 pages flagged in the last 14 days, 2 waiting for your review.');
  });

  it('falls back when OpenAI returns an empty response', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '', totalTokens: 0 });

    const result = await generateDashboardInsight(
      { pagesScanned: 10, guardCatches: 0, guardCatchesDelta: null, pendingCount: 0, rangeDays: 7 },
      callOpenAI
    );

    expect(result).toBe('0 pages flagged in the last 7 days, 0 waiting for your review.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/dashboard-insight.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/dashboard-insight.ts
import OpenAI from 'openai';

export interface DashboardInsightInput {
  pagesScanned: number;
  guardCatches: number;
  guardCatchesDelta: number | null;
  pendingCount: number;
  rangeDays: number;
}

type OpenAICaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = 'openai/gpt-oss-120b';

function buildPrompt(input: DashboardInsightInput): string {
  return [
    "You write a one-sentence summary for a website owner's SEO safety dashboard.",
    'Rules:',
    '- Base the summary ONLY on the numbers given below. Never invent facts, numbers, or trends not present in them.',
    '- One or two short sentences, plain English, no jargon.',
    '- Output ONLY the summary text. No quotes, no preamble, no explanation.',
    '',
    `Pages scanned in the last ${input.rangeDays} days: ${input.pagesScanned}`,
    `Pages flagged or blocked by ProofLayer: ${input.guardCatches}`,
    `Change vs the prior period: ${input.guardCatchesDelta === null ? 'no prior data' : `${input.guardCatchesDelta}%`}`,
    `Drafts currently waiting for review: ${input.pendingCount}`,
  ].join('\n');
}

function fallbackInsight(input: DashboardInsightInput): string {
  return `${input.guardCatches} pages flagged in the last ${input.rangeDays} days, ${input.pendingCount} waiting for your review.`;
}

async function defaultCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    timeout: 15_000,
    maxRetries: 1,
  });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function generateDashboardInsight(
  input: DashboardInsightInput,
  callOpenAI: OpenAICaller = defaultCaller
): Promise<string> {
  try {
    const { content } = await callOpenAI(buildPrompt(input));
    if (!content) return fallbackInsight(input);
    return content;
  } catch {
    return fallbackInsight(input);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/dashboard-insight.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Write `AiInsightCard`**

```tsx
// src/components/dashboard/ai-insight-card.tsx
import { Sparkle } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent } from '@/components/ui/card';

export function AiInsightCard({ summary }: { summary: string }) {
  return (
    <Card className="border-accent/20 bg-accent/5">
      <CardContent className="flex items-start gap-3 p-4">
        <Sparkle size={18} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-accent">AI summary</span>
          <p className="mt-1 text-sm text-foreground">{summary}</p>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all 191 tests pass (188 from Task 1 + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboard-insight.ts src/lib/dashboard-insight.test.ts src/components/dashboard/ai-insight-card.tsx
git commit -m "feat: add AI-generated dashboard insight summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 3: Tabs shell and date-range selector

**Files:**
- Create: `src/components/ui/tabs.tsx` (via shadcn CLI)
- Create: `src/components/ui/select.tsx` (via shadcn CLI)
- Create: `src/components/dashboard/dashboard-tabs.tsx`
- Create: `src/components/dashboard/date-range-select.tsx`

**Interfaces:**
- Produces: `export function DashboardTabs({ overview, analytics, reviewQueue, outcomes }: { overview: ReactNode; analytics: ReactNode; reviewQueue: ReactNode; outcomes: ReactNode })` and `export function DateRangeSelect({ value }: { value: number })`. Task 6 (page wiring) renders both.

- [ ] **Step 1: Install the shadcn primitives**

```bash
cd /Users/surya/Projects/dex-ai
npx shadcn@latest add tabs select --yes
```

If this prompts interactively for anything, accept the defaults (this project's `components.json` is already configured — style `new-york`, RSC enabled).

- [ ] **Step 2: Write `DashboardTabs`**

```tsx
// src/components/dashboard/dashboard-tabs.tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'review', label: 'Review queue' },
  { value: 'outcomes', label: 'Outcomes' },
] as const;

export function DashboardTabs({
  overview,
  analytics,
  reviewQueue,
  outcomes,
}: {
  overview: ReactNode;
  analytics: ReactNode;
  reviewQueue: ReactNode;
  outcomes: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'overview';

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={handleChange} className="mt-6">
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="overview" className="mt-4">
        {overview}
      </TabsContent>
      <TabsContent value="analytics" className="mt-4">
        {analytics}
      </TabsContent>
      <TabsContent value="review" className="mt-4">
        {reviewQueue}
      </TabsContent>
      <TabsContent value="outcomes" className="mt-4">
        {outcomes}
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 3: Write `DateRangeSelect`**

```tsx
// src/components/dashboard/date-range-select.tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
] as const;

export function DateRangeSelect({ value }: { value: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', next);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <Select value={String(value)} onValueChange={handleChange}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Run the full test suite and typecheck**

```bash
npm test
npx tsc --noEmit
```

Expected: all 191 tests pass, zero type errors (these two components have no dedicated tests — matches this codebase's existing convention of no `*.test.tsx` files for client components — and are not wired into `page.tsx` until Task 6, so this step confirms they compile cleanly in isolation).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/tabs.tsx src/components/ui/select.tsx src/components/dashboard/dashboard-tabs.tsx src/components/dashboard/date-range-select.tsx
git commit -m "feat: add dashboard tabs shell and date-range selector

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 4: MagicUI components — NumberTicker, MagicCard, BorderBeam

**Files:**
- Create: `src/components/magicui/number-ticker.tsx` (via MagicUI CLI)
- Create: `src/components/magicui/magic-card.tsx` (via MagicUI CLI)
- Create: `src/components/magicui/border-beam.tsx` (via MagicUI CLI)
- Modify: `src/components/dashboard/stat-card.tsx`
- Modify: `src/components/dashboard/live-scan-panel.tsx`

**Interfaces:**
- Consumes: none from prior tasks.
- Produces: `StatCard` now renders its numeric value via `NumberTicker` and wraps its content in `MagicCard` instead of the plain shadcn `Card`. `LiveScanPanel` renders `BorderBeam` around its container only while a job is in-flight. No other task depends on these — purely visual.

- [ ] **Step 1: Install the MagicUI components**

```bash
cd /Users/surya/Projects/dex-ai
npx @magicuidesign/cli@latest add number-ticker magic-card border-beam
```

If the MCP server registered in `.mcp.json` is connected in this session, you may instead fetch each component's source via the MCP tools and write the files directly — either path produces the same three files under `src/components/magicui/`. If neither the CLI nor the MCP server is reachable (e.g. no network), STOP and report BLOCKED rather than hand-writing the components from memory — these need to match MagicUI's actual current source exactly.

- [ ] **Step 2: Read the installed `number-ticker.tsx` and `magic-card.tsx` to confirm their exact prop names**

MagicUI components' prop APIs are what you just installed — read the files before wiring them in, don't assume a prop shape.

- [ ] **Step 3: Wire `NumberTicker` and `MagicCard` into `StatCard`**

Read the current `src/components/dashboard/stat-card.tsx` (shown in the plan's context below) and:
- Replace the `Card`/`CardContent` wrapper with `MagicCard` (check its actual prop API from Step 2 — typically it wraps children and accepts a `className`; preserve the existing `animate-stat-card-in` class and the `style` prop for the existing stagger-delay animation).
- Replace the raw `<span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>` with `NumberTicker` — but `NumberTicker` animates a *number*, and `StatCard`'s `value` prop is a pre-formatted `string` (e.g. `"12,480"` with a comma, or a plain page count). Check whether the current callers pass anything non-numeric before assuming `NumberTicker` can be dropped in directly — `src/app/dashboard/page.tsx`'s three `StatCard` calls pass `String(latestSummary?.pagesScanned ?? 0)`, `String(stats.guardCatches)`, and `stats.tokensSpent.toLocaleString()`. `NumberTicker` needs a raw numeric `value` prop, not a formatted string — so `StatCard` needs a new numeric prop for this (e.g. `numericValue: number`) alongside the existing formatted `value: string`, and Task 6 will pass both from `page.tsx` (the numeric value for the ticker's animation target, the formatted string only as a fallback if `NumberTicker` doesn't support locale formatting — check its actual API in Step 2 for whether it has its own formatting props before adding a redundant one).

Current `stat-card.tsx` for reference (do not guess at this — it's shown here exactly):

```tsx
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { DeltaBadge } from '@/components/dashboard/delta-badge';
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
          <DeltaBadge delta={delta} />
        </div>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        {updatedAt && <span className="text-xs text-muted-foreground">Updated {formatRelativeTime(updatedAt)}</span>}
        {chart && <div className="mt-1">{chart}</div>}
      </CardContent>
    </Card>
  );
}
```

Add a `numericValue?: number` prop: when present, render `NumberTicker` with it (respecting `prefers-reduced-motion` — check whether MagicUI's `NumberTicker` already handles this internally via the installed source from Step 2; if it doesn't, wrap it so the ticker renders the final `numericValue` immediately with no animation for reduced-motion users, matching the pattern already used in `Reveal`/`Hero`/`Waves`). When `numericValue` is absent, fall back to rendering the plain `value` string exactly as today (so any future caller that doesn't pass a number doesn't break).

- [ ] **Step 4: Wire `BorderBeam` into `LiveScanPanel`**

Read the current full `src/components/dashboard/live-scan-panel.tsx`. It already tracks job status via `IN_FLIGHT_STATUSES = new Set(['queued', 'running'])` and re-renders on poll. Find its outermost returned container element and conditionally wrap it (or add `BorderBeam` as a child, per its actual API from Step 2 — some MagicUI components render as an absolutely-positioned overlay child rather than a wrapper) only when the current latest job's status is in `IN_FLIGHT_STATUSES`.

- [ ] **Step 5: Run the full test suite and typecheck**

```bash
npm test
npx tsc --noEmit
```

Expected: all 191 tests pass (`StatCard`/`LiveScanPanel` have no dedicated unit tests, matching existing convention — this step confirms nothing else broke), zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/magicui src/components/dashboard/stat-card.tsx src/components/dashboard/live-scan-panel.tsx
git commit -m "feat: add MagicUI number-ticker, magic-card, and border-beam to dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 5: Pass-rate bullet chart and Outcomes summary card

**Files:**
- Create: `src/components/dashboard/pass-rate-bullet.tsx`
- Create: `src/components/dashboard/outcomes-summary.tsx`

**Interfaces:**
- Consumes: `PassRateTarget` and `OutcomesSummary` types from `@/lib/dashboard-stats` (Task 1).
- Produces: `export function PassRateBullet({ data }: { data: PassRateTarget })` and `export function OutcomesSummary({ data }: { data: OutcomesSummaryData })` (renamed to `OutcomesSummaryData` as the imported type alias to avoid a name collision with the component itself — see Step 2). Task 6 (page wiring) renders both.

- [ ] **Step 1: Write `PassRateBullet`**

A horizontal bar (current pass rate) with a vertical reference line (the 90% target), built on the same Recharts + `ChartContainer` pattern already used by `MiniBarChart`:

```tsx
// src/components/dashboard/pass-rate-bullet.tsx
'use client';

import { Bar, BarChart, ReferenceLine, XAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { PassRateTarget } from '@/lib/dashboard-stats';

const chartConfig: ChartConfig = { passRate: { label: 'Pass rate', color: 'var(--dex-app-success, #10b981)' } };

export function PassRateBullet({ data }: { data: PassRateTarget }) {
  const chartData = [{ name: 'ProofLayer pass rate', passRate: data.passRate }];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">ProofLayer pass rate</span>
        <span className="text-sm font-semibold text-foreground">
          {data.passRate}% <span className="font-normal text-muted-foreground">/ {data.target}% target</span>
        </span>
      </div>
      <ChartContainer config={chartConfig} className="h-10 w-full">
        <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <Bar dataKey="passRate" fill="var(--color-passRate)" radius={[4, 4, 4, 4]} barSize={16} />
          <ReferenceLine x={data.target} stroke="var(--dex-app-warning, #ffb020)" strokeWidth={2} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
```

- [ ] **Step 2: Write `OutcomesSummary`**

```tsx
// src/components/dashboard/outcomes-summary.tsx
import { TrendUp, TrendDown } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OutcomesSummary as OutcomesSummaryData } from '@/lib/dashboard-stats';

export function OutcomesSummary({ data }: { data: OutcomesSummaryData }) {
  if (data.measuredCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Outcomes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No measured outcomes yet — GSC results appear here 28 days after an approved change.
          </p>
        </CardContent>
      </Card>
    );
  }

  const winRate = Math.round((data.winCount / data.measuredCount) * 100);
  const clicksPositive = data.totalClicksDelta >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Outcomes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground">{winRate}%</span>
          <span className="text-sm text-muted-foreground">win rate across {data.measuredCount} measured change{data.measuredCount === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {clicksPositive ? (
            <TrendUp size={16} weight="bold" className="text-[var(--dex-app-success)]" aria-hidden="true" />
          ) : (
            <TrendDown size={16} weight="bold" className="text-[var(--dex-app-danger)]" aria-hidden="true" />
          )}
          <span className="text-foreground">
            {clicksPositive ? '+' : ''}
            {data.totalClicksDelta} clicks, {data.totalImpressionsDelta >= 0 ? '+' : ''}
            {data.totalImpressionsDelta} impressions total
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Run the full test suite and typecheck**

```bash
npm test
npx tsc --noEmit
```

Expected: all 191 tests pass, zero type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/pass-rate-bullet.tsx src/components/dashboard/outcomes-summary.tsx
git commit -m "feat: add pass-rate bullet chart and outcomes summary components

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 6: Wire it all together in `dashboard/page.tsx`

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `DashboardTabs`, `DateRangeSelect` (Task 3); `AiInsightCard` + `generateDashboardInsight` (Task 2); `PassRateBullet`, `OutcomesSummary` (Task 5); `computePassRate`, `computeOutcomesSummary` (Task 1).

- [ ] **Step 1: Read the current full `src/app/dashboard/page.tsx`**

Already shown in full in this plan's design spec context — re-read the live file before editing, since it's the file every prior phase this session touched last (via the `isFinal`/undo/evidence-pack additions on the *review* page, not this one — confirm `dashboard/page.tsx` itself matches what's expected before editing, since this task makes the largest single-file change in the plan).

- [ ] **Step 2: Accept and validate the `range` and `tab` search params**

Add to the page's props and validate against the fixed set from the design (7/14/30/90, default 14):

```typescript
const VALID_RANGES = [7, 14, 30, 90] as const;

function parseRange(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (VALID_RANGES as readonly number[]).includes(n) ? n : 14;
}
```

`DashboardPage`'s signature becomes `export default async function DashboardPage({ searchParams }: { searchParams: { range?: string } })`, and every place the page currently hardcodes `14` (in `computeActivitySeries(activityJobs, actions, 14)`, `computeGuardCatchSeries(actions, 14)`, `computeTokenSeries(actions, 14)`, and `splitByPeriod(actions, 7)`) uses `parseRange(searchParams.range)` instead — except `splitByPeriod`'s `7`, which stays fixed at 7 (it's a "this week vs last week" comparison, a different concept from the trend-chart window; the design spec doesn't ask to make it configurable, and changing it would silently change what "vs last week" means).

- [ ] **Step 3: Widen the `actions` query and compute the two new aggregates**

The existing `db.action.findMany` select needs three more fields for `computeOutcomesSummary`:

```typescript
        db.action.findMany({
          where: { customerId: customer.id },
          select: {
            status: true,
            tokenCost: true,
            createdAt: true,
            guardResult: { select: { outcome: true } },
            outcomeMeasuredAt: true,
            baselinePerformance: true,
            outcomePerformance: true,
          },
        }),
```

After the existing stat computations, add:

```typescript
  const passRate = computePassRate(guardCounts);
  const outcomesSummary = computeOutcomesSummary(actions);
```

- [ ] **Step 4: Generate the AI insight**

After computing `stats`/`guardCatchesDelta` (already present in the current file), add:

```typescript
  const insight = siteSelected && latestScanJob
    ? await generateDashboardInsight({
        pagesScanned: latestSummary?.pagesScanned ?? 0,
        guardCatches: stats.guardCatches,
        guardCatchesDelta: guardCatchesDelta,
        pendingCount: stats.pendingCount,
        rangeDays: parseRange(searchParams.range),
      })
    : null;
```

- [ ] **Step 5: Restructure the JSX into four tab panels**

The current file's structure (header, GSC-connect gates, and then the `siteSelected && latestScanJob` block containing `ScanHealthCard`, the 3 `StatCard`s + `ComparisonBar` grid, `GuardBreakdown`, and `LiveScanPanel`) needs to split that last block's contents across the four `DashboardTabs` props instead of one flat `<>...</>` fragment:

- `overview`: `<AiInsightCard summary={insight} />` (only when `insight` is non-null) followed by `ScanHealthCard` and the `StatCard`/`ComparisonBar` grid, unchanged otherwise. Pass `numericValue` alongside the existing `value` string to each `StatCard` (e.g. `numericValue={latestSummary?.pagesScanned ?? 0}` for the first card, `numericValue={stats.guardCatches}` for the second, `numericValue={stats.tokensSpent}` for the third).
- `analytics`: the existing `MiniBarChart`s (already present inside the `StatCard`s today — leave those where they are; this tab is for the new `PassRateBullet` plus a `DateRangeSelect` positioned above it) — add `<DateRangeSelect value={parseRange(searchParams.range)} />` then `<PassRateBullet data={passRate} />`.
- `reviewQueue`: `<LiveScanPanel initialJobs={recentJobs} />`, unchanged.
- `outcomes`: `<OutcomesSummary data={outcomesSummary} />`.

Everything outside the `siteSelected && latestScanJob` block (the header, the GSC-connect gate, the site-selection gate, the "no scans yet" gate) stays exactly as it is today — `DashboardTabs` only replaces the innermost content once a scan has actually run.

- [ ] **Step 6: Run the full test suite, typecheck, and a manual browser check**

```bash
npm test
npx tsc --noEmit
npm run dev
```

Use the `browse` skill (per this project's standing rule) to open `/dashboard-preview`-style mock data if real GSC-connected data isn't available in this environment, or seed a customer/action row directly via Prisma Studio / a script if needed to see the real `/dashboard` route render. Confirm: all four tabs render and switch without a full page reload (URL updates with `?tab=`), the date-range selector updates `?range=` and the trend data changes, the AI insight card shows a sentence (or the fallback sentence if `OPENAI_API_KEY` isn't set in this environment), and the Outcomes tab shows the empty state correctly when no actions have `outcomeMeasuredAt` set.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: restructure dashboard into tabs with AI insight, pass-rate, and outcomes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

## Self-Review

**Spec coverage:** All six design-doc pieces (tabs shell, date range, AI insight, outcomes aggregate, pass-rate chart, MagicUI visual pass) map one-to-one to Tasks 1-6. "Out of scope" items (multi-site, configurable target, calendar picker, review-page changes) have no corresponding task — correctly excluded.

**Placeholder scan:** No TBD/TODO. Task 4's MagicUI wiring is deliberately less prescriptive than other tasks (it tells the implementer to read the actual installed component source before wiring props) because the exact prop API of a third-party library isn't something to guess at in a plan written before that library's source is on disk — this is a scoped instruction to verify, not a placeholder.

**Type consistency:** `PassRateTarget`/`OutcomesSummary` (Task 1) are imported by name into Task 5's components exactly as defined. `DashboardInsightInput` (Task 2) field names (`pagesScanned`, `guardCatches`, `guardCatchesDelta`, `pendingCount`, `rangeDays`) match exactly what Task 6 constructs from existing `page.tsx` variables (`latestSummary`, `stats`, `guardCatchesDelta`, `parseRange`). `DashboardTabs`' four prop names (`overview`, `analytics`, `reviewQueue`, `outcomes`) match what Task 6 passes.
