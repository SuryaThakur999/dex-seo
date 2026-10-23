# Dashboard Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `src/app/dashboard/page.tsx` from an unstyled scaffold into a real dashboard using only data that already exists in the schema, and extend Dex's coral brand identity into the authenticated app.

**Architecture:** Server component (`page.tsx`) fetches customer/scan/action data and hands it to three small presentational components (`StatCard`, `ScanActivity`, `GuardBreakdown`). Aggregation logic (counting, JSON parsing) lives in a pure, unit-tested lib module (`dashboard-stats.ts`) rather than inline in the page, so it's testable without a DOM.

**Tech Stack:** Next.js 14 App Router, Tailwind v4 (CSS-first, `@theme inline`), shadcn/ui primitives already in `src/components/ui/`, Prisma, Vitest (node environment, no jsdom configured).

## Global Constraints

- No schema changes, no new npm dependencies (lucide-react is already installed at `^1.33.0`).
- All numbers shown must come from real DB data — no fabricated metrics, no placeholder charts for data that doesn't exist.
- Motion: critically damped only, `prefers-reduced-motion` must be respected everywhere motion is added.
- `--accent` token change cascades globally — verify `/review` and `/settings` still look correct after Task 6, don't restyle them further.
- Path alias `@/*` → `./src/*` (both `tsconfig.json` and `vitest.config.ts`).

---

### Task 1: Dashboard stats lib

**Files:**
- Create: `src/lib/dashboard-stats.ts`
- Test: `src/lib/dashboard-stats.test.ts`

**Interfaces:**
- Produces: `ActionForStats` (`{ status: string; tokenCost: number | null; guardResult: { outcome: string } | null }`), `DashboardStats` (`{ pendingCount: number; guardCatches: number; tokensSpent: number }`), `GuardCounts` (`{ pass: number; flag: number; block: number }`), `ScanResultSummary` (`{ pagesScanned: number; pagesFlagged: number; draftsCreated: number; errors: { url: string; error: string }[] }`).
- Produces functions: `computeDashboardStats(actions: ActionForStats[]): DashboardStats`, `computeGuardBreakdown(actions: ActionForStats[]): GuardCounts`, `parseScanResultSummary(json: unknown): ScanResultSummary | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/dashboard-stats.test.ts
import { describe, it, expect } from 'vitest';
import { computeDashboardStats, computeGuardBreakdown, parseScanResultSummary } from './dashboard-stats';

describe('computeDashboardStats', () => {
  it('counts pending actions, guard catches, and token spend', () => {
    const actions = [
      { status: 'pending', tokenCost: 10, guardResult: { outcome: 'pass' } },
      { status: 'pending', tokenCost: 20, guardResult: { outcome: 'flag' } },
      { status: 'approved', tokenCost: 15, guardResult: { outcome: 'block' } },
      { status: 'approved', tokenCost: null, guardResult: null },
    ];
    expect(computeDashboardStats(actions)).toEqual({ pendingCount: 2, guardCatches: 2, tokensSpent: 45 });
  });

  it('returns zeros for an empty action list', () => {
    expect(computeDashboardStats([])).toEqual({ pendingCount: 0, guardCatches: 0, tokensSpent: 0 });
  });
});

describe('computeGuardBreakdown', () => {
  it('counts each outcome bucket and ignores actions with no guard result', () => {
    const actions = [
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'pass' } },
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'pass' } },
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'flag' } },
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'block' } },
      { status: 'pending', tokenCost: null, guardResult: null },
    ];
    expect(computeGuardBreakdown(actions)).toEqual({ pass: 2, flag: 1, block: 1 });
  });

  it('returns zeros for an empty action list', () => {
    expect(computeGuardBreakdown([])).toEqual({ pass: 0, flag: 0, block: 0 });
  });
});

describe('parseScanResultSummary', () => {
  it('parses a valid scan result JSON blob', () => {
    const json = { pagesScanned: 12, pagesFlagged: 4, draftsCreated: 3, errors: [] };
    expect(parseScanResultSummary(json)).toEqual(json);
  });

  it('returns null for null, non-object, or missing pagesScanned', () => {
    expect(parseScanResultSummary(null)).toBeNull();
    expect(parseScanResultSummary('not an object')).toBeNull();
    expect(parseScanResultSummary({})).toBeNull();
  });

  it('defaults missing optional fields to zero/empty', () => {
    expect(parseScanResultSummary({ pagesScanned: 5 })).toEqual({
      pagesScanned: 5,
      pagesFlagged: 0,
      draftsCreated: 0,
      errors: [],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/lib/dashboard-stats.test.ts`
Expected: FAIL with "Cannot find module './dashboard-stats'" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/dashboard-stats.ts
export type GuardOutcome = 'pass' | 'flag' | 'block';

export interface ActionForStats {
  status: string;
  tokenCost: number | null;
  guardResult: { outcome: string } | null;
}

export interface DashboardStats {
  pendingCount: number;
  guardCatches: number;
  tokensSpent: number;
}

export function computeDashboardStats(actions: ActionForStats[]): DashboardStats {
  let pendingCount = 0;
  let guardCatches = 0;
  let tokensSpent = 0;

  for (const action of actions) {
    if (action.status === 'pending') pendingCount += 1;
    const outcome = action.guardResult?.outcome;
    if (outcome === 'flag' || outcome === 'block') guardCatches += 1;
    tokensSpent += action.tokenCost ?? 0;
  }

  return { pendingCount, guardCatches, tokensSpent };
}

export interface GuardCounts {
  pass: number;
  flag: number;
  block: number;
}

const GUARD_OUTCOMES: readonly GuardOutcome[] = ['pass', 'flag', 'block'];

export function computeGuardBreakdown(actions: ActionForStats[]): GuardCounts {
  const counts: GuardCounts = { pass: 0, flag: 0, block: 0 };

  for (const action of actions) {
    const outcome = action.guardResult?.outcome;
    if (outcome && (GUARD_OUTCOMES as readonly string[]).includes(outcome)) {
      counts[outcome as GuardOutcome] += 1;
    }
  }

  return counts;
}

export interface ScanResultSummary {
  pagesScanned: number;
  pagesFlagged: number;
  draftsCreated: number;
  errors: { url: string; error: string }[];
}

export function parseScanResultSummary(json: unknown): ScanResultSummary | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.pagesScanned !== 'number') return null;

  return {
    pagesScanned: obj.pagesScanned,
    pagesFlagged: typeof obj.pagesFlagged === 'number' ? obj.pagesFlagged : 0,
    draftsCreated: typeof obj.draftsCreated === 'number' ? obj.draftsCreated : 0,
    errors: Array.isArray(obj.errors) ? (obj.errors as { url: string; error: string }[]) : [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/lib/dashboard-stats.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-stats.ts src/lib/dashboard-stats.test.ts
git commit -m "feat: add dashboard stats aggregation lib"
```

---

### Task 2: Brand tokens — accent color, mono font, sharp badges

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/ui/badge.tsx`
- Modify: `src/components/ui/button.tsx`

**Interfaces:**
- Produces: `.font-mono` Tailwind utility (`'Fira Code', monospace`), `.animate-stat-card-in` CSS animation class, `Button` variant `"accent"`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Update `globals.css` tokens**

In `src/app/globals.css`, change the `--accent` line inside `:root`:

```css
  --accent: #FF4D2E;
```

(was `--accent: #0369A1;`)

Add `--font-mono` to the `@theme inline` block, right after `--color-ring: var(--ring);`:

```css
  --font-mono: 'Fira Code', monospace;
```

Add this new block at the end of the file, after the existing `code, pre, kbd` rule:

```css
@keyframes stat-card-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-stat-card-in {
  animation: stat-card-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .animate-stat-card-in {
    animation: none;
    opacity: 1;
  }
}
```

- [ ] **Step 2: Sharpen Badge to a mono system-status look**

In `src/components/ui/badge.tsx`, change the base classes in `badgeVariants`:

```typescript
const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
  {
```

(was `'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium'`) — leave the `variants.variant` color definitions untouched.

- [ ] **Step 3: Add an `accent` Button variant**

In `src/components/ui/button.tsx`, add a new entry to `variants.variant` in `buttonVariants`, alongside `default`/`outline`/`destructive`/`ghost`:

```typescript
        accent: 'bg-accent text-accent-foreground hover:bg-accent/90',
```

- [ ] **Step 4: Verify the build still type-checks**

Run: `npm run build`
Expected: succeeds (Prisma generate + Next build + type-check), no errors. (No existing test touches these files directly — `guard-outcome-ui.test.ts` doesn't exist, so this is a build-verification step, not a unit test.)

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/components/ui/badge.tsx src/components/ui/button.tsx
git commit -m "feat: extend Dex's coral brand into the authenticated app"
```

---

### Task 3: StatCard component

**Files:**
- Create: `src/components/dashboard/stat-card.tsx`

**Interfaces:**
- Consumes: `Card`, `CardContent` from `@/components/ui/card`; `cn` from `@/lib/utils`; `LucideIcon` type from `lucide-react`.
- Produces: `StatCard` component with props `{ label: string; value: string; hint?: string; icon: LucideIcon; tone?: 'default' | 'accent'; style?: React.CSSProperties }`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/stat-card.tsx
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: 'default' | 'accent';
  style?: React.CSSProperties;
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', style }: StatCardProps) {
  return (
    <Card className="animate-stat-card-in transition-transform duration-150 ease-out active:scale-[0.97]" style={style}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <Icon className={cn('h-4 w-4', tone === 'accent' ? 'text-accent' : 'text-muted-foreground')} aria-hidden="true" />
        </div>
        <span className="font-mono text-2xl font-semibold text-foreground">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: succeeds. (Presentational component, no unit test — matches the existing codebase's pattern where `src/components/*.tsx` files have no test siblings; only `src/lib/*.ts` and `src/app/api/**/route.ts` are unit tested.)

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/stat-card.tsx
git commit -m "feat: add StatCard dashboard component"
```

---

### Task 4: ScanActivity component

**Files:**
- Create: `src/components/dashboard/scan-activity.tsx`

**Interfaces:**
- Consumes: `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card`; `Badge` from `@/components/ui/badge`.
- Produces: `ScanActivity` component with prop `{ jobs: ScanActivityJob[] }` where `ScanActivityJob = { id: string; status: string; createdAt: Date; completedAt: Date | null; error: string | null }`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/scan-activity.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ScanActivityJob {
  id: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

function formatRelativeTime(date: Date): string {
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export function ScanActivity({ jobs }: { jobs: ScanActivityJob[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Scan activity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {jobs.length === 0 && <p className="text-sm text-muted-foreground">No scans yet. Run your first scan above.</p>}
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
          >
            <div className="flex items-center gap-2">
              {job.status === 'running' && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
              )}
              <Badge variant={STATUS_VARIANT[job.status] ?? 'outline'}>{STATUS_LABEL[job.status] ?? job.status}</Badge>
              {job.status === 'failed' && job.error && (
                <span className="line-clamp-1 text-xs text-muted-foreground">{job.error}</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{formatRelativeTime(job.completedAt ?? job.createdAt)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/scan-activity.tsx
git commit -m "feat: add ScanActivity dashboard component"
```

---

### Task 5: GuardBreakdown component

**Files:**
- Create: `src/components/dashboard/guard-breakdown.tsx`

**Interfaces:**
- Consumes: `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card`; `Link` from `next/link`; `GuardCounts` type from `@/lib/dashboard-stats` (Task 1).
- Produces: `GuardBreakdown` component with prop `{ counts: GuardCounts }`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/guard-breakdown.tsx
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GuardCounts } from '@/lib/dashboard-stats';

const ROWS: { key: keyof GuardCounts; label: string; barClass: string }[] = [
  { key: 'pass', label: 'Passed', barClass: 'bg-emerald-500' },
  { key: 'flag', label: 'Needs review', barClass: 'bg-amber-500' },
  { key: 'block', label: 'Blocked', barClass: 'bg-red-500' },
];

export function GuardBreakdown({ counts }: { counts: GuardCounts }) {
  const total = counts.pass + counts.flag + counts.block;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">GrowthGuard breakdown</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {total === 0 && (
          <p className="text-sm text-muted-foreground">No drafts checked yet. Run a scan to see GrowthGuard in action.</p>
        )}
        {total > 0 &&
          ROWS.map((row) => {
            const count = counts[row.key];
            const pct = Math.round((count / total) * 100);
            return (
              <div key={row.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{row.label}</span>
                  <span className="font-mono text-muted-foreground">
                    {count} &middot; {pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-sm bg-muted">
                  <div className={`h-full rounded-sm ${row.barClass}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        <Link href="/review" className="mt-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
          View review queue &rarr;
        </Link>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/guard-breakdown.tsx
git commit -m "feat: add GuardBreakdown dashboard component"
```

---

### Task 6: Rebuild the dashboard page

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-5 (`computeDashboardStats`, `computeGuardBreakdown`, `parseScanResultSummary` from `@/lib/dashboard-stats`; `StatCard`, `ScanActivity`, `GuardBreakdown` from `@/components/dashboard/*`; `Button` variant `"accent"` from Task 2), plus existing `ensureCustomer`, `PENDING_WEBSITE_URL` (`@/lib/customer`), `decrypt` (`@/lib/crypto`), `listVerifiedSites` (`@/lib/gsc-client`), `db` (`@/lib/db`).

- [ ] **Step 1: Replace the page**

```tsx
// src/app/dashboard/page.tsx
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { FileSearch, Inbox, ShieldCheck, Coins, RefreshCw, Link2 } from 'lucide-react';
import { ensureCustomer, PENDING_WEBSITE_URL } from '@/lib/customer';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites } from '@/lib/gsc-client';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/dashboard/stat-card';
import { ScanActivity } from '@/components/dashboard/scan-activity';
import { GuardBreakdown } from '@/components/dashboard/guard-breakdown';
import { computeDashboardStats, computeGuardBreakdown, parseScanResultSummary } from '@/lib/dashboard-stats';

export default async function DashboardPage() {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  const customer = await ensureCustomer(userId, PENDING_WEBSITE_URL);
  const gscConnected = Boolean(customer.gscRefreshToken);
  const siteSelected = gscConnected && customer.websiteUrl !== PENDING_WEBSITE_URL;

  let verifiedSites: string[] = [];
  let siteListError: string | null = null;
  if (gscConnected && !siteSelected) {
    try {
      verifiedSites = await listVerifiedSites(decrypt(customer.gscRefreshToken!));
    } catch {
      siteListError = 'Could not load your Search Console properties. Try reconnecting.';
    }
  }

  const [recentJobs, actions] = siteSelected
    ? await Promise.all([
        db.scanJob.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
        db.action.findMany({ where: { customerId: customer.id }, include: { guardResult: true } }),
      ])
    : [[], []];

  const latestScanJob = recentJobs[0] ?? null;
  const latestSummary = latestScanJob ? parseScanResultSummary(latestScanJob.resultSummary) : null;
  const stats = computeDashboardStats(actions);
  const guardCounts = computeGuardBreakdown(actions);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          {siteSelected && <p className="mt-1 text-sm text-muted-foreground">{customer.websiteUrl}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={gscConnected ? 'default' : 'outline'}>
            {gscConnected ? 'Search Console connected' : 'Not connected'}
          </Badge>
          {siteSelected && (
            <form action="/api/scan" method="post">
              <Button type="submit" variant="accent">
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Scan now
              </Button>
            </form>
          )}
        </div>
      </header>

      <nav className="mt-2 flex gap-4 text-sm">
        <Link href="/review" className="font-medium text-accent underline-offset-4 hover:underline">
          Review queue
        </Link>
        <Link href="/settings" className="font-medium text-accent underline-offset-4 hover:underline">
          Settings
        </Link>
      </nav>

      {!gscConnected && (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-start gap-3 py-10">
            <Link2 className="h-6 w-6 text-accent" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Connect Google Search Console so Dex can find pages worth improving on your site.
            </p>
            <Button asChild variant="accent">
              <a href="/api/gsc/connect">Connect Google Search Console</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {gscConnected && !siteSelected && (
        <Card className="mt-8">
          <CardContent className="flex flex-col gap-3 py-6">
            {siteListError && <p className="text-sm text-destructive">{siteListError}</p>}
            {!siteListError && verifiedSites.length === 0 && (
              <p className="text-sm text-muted-foreground">No verified Search Console properties found for this account.</p>
            )}
            {!siteListError && verifiedSites.length > 0 && (
              <form action="/api/gsc/select-site" method="post" className="flex flex-wrap items-center gap-3">
                <label htmlFor="siteUrl" className="text-sm font-medium text-foreground">
                  Choose a verified property:
                </label>
                <select id="siteUrl" name="siteUrl" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
                  {verifiedSites.map((site) => (
                    <option key={site} value={site}>
                      {site}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="accent">
                  Use this site
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {siteSelected && !latestScanJob && (
        <Card className="mt-8">
          <CardContent className="py-10 text-sm text-muted-foreground">
            No scans yet. Hit &ldquo;Scan now&rdquo; above and Dex will crawl your site, find pages worth improving, and
            draft meta descriptions with GrowthGuard checking every one before it reaches you.
          </CardContent>
        </Card>
      )}

      {siteSelected && latestScanJob && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Pages scanned"
              value={String(latestSummary?.pagesScanned ?? 0)}
              hint="Last scan"
              icon={FileSearch}
              style={{ animationDelay: '0ms' }}
            />
            <StatCard
              label="Pending review"
              value={String(stats.pendingCount)}
              hint="Drafts waiting on you"
              icon={Inbox}
              tone="accent"
              style={{ animationDelay: '60ms' }}
            />
            <StatCard
              label="GrowthGuard catches"
              value={String(stats.guardCatches)}
              hint="Flagged or blocked before reaching you"
              icon={ShieldCheck}
              style={{ animationDelay: '120ms' }}
            />
            <StatCard
              label="Tokens spent"
              value={stats.tokensSpent.toLocaleString()}
              hint="All-time"
              icon={Coins}
              style={{ animationDelay: '180ms' }}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ScanActivity jobs={recentJobs} />
            <GuardBreakdown counts={guardCounts} />
          </div>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all existing tests plus the 7 new `dashboard-stats.test.ts` tests pass (105 total).

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: succeeds — this is a Clerk-authenticated server component, so it can't be exercised by a plain unit test; the build's type-check is the correctness gate for the JSX wiring itself.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: rebuild dashboard with real scan/guard/token data"
```

---

### Task 7: Visual verification pass

**Files:** none (verification only — no code changes expected; if this task finds a bug, fix it and fold the fix into this task's commit).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)
Expected: server starts on `http://localhost:3000`.

- [ ] **Step 2: Screenshot the dashboard at desktop and mobile widths**

Use the `/browse` skill (per this project's `CLAUDE.md`, never `mcp__claude-in-chrome__*`):

```bash
$B goto http://localhost:3000/dashboard
$B viewport 1440x900
$B screenshot /tmp/dashboard-desktop.png
$B viewport 375x812
$B screenshot /tmp/dashboard-mobile.png
```

Read both PNGs. Verify: coral accent renders (not blue), stat cards use Fira Code numerals, badges are sharp-cornered uppercase mono, no horizontal scroll at 375px, stat grid collapses to 1 column on mobile / 2 on tablet / 4 on desktop.

- [ ] **Step 3: Verify `/review` and `/settings` still look correct**

```bash
$B goto http://localhost:3000/review
$B screenshot /tmp/review-check.png
$B goto http://localhost:3000/settings
$B screenshot /tmp/settings-check.png
```

Read both PNGs. Verify the `--accent` token cascade (Task 2) didn't break their layout — links and badges should now show coral instead of blue, everything else unchanged.

- [ ] **Step 4: Verify `prefers-reduced-motion`**

```bash
$B js "matchMedia('(prefers-reduced-motion: reduce)').matches" # sanity-check the query works
```

In DevTools (or via CDP `Emulation.setEmulatedMedia`), confirm the stat-card fade-up and the running-scan pulse both go static under reduced motion — this can't be screenshotted meaningfully, so confirm by reading `src/app/globals.css`'s `@media (prefers-reduced-motion: reduce)` block and `scan-activity.tsx`'s `motion-reduce:animate-none` class are both present (already true from Tasks 2 and 4 — this step is a re-confirmation, not new code).

- [ ] **Step 5: Fix anything found, then final commit if changes were made**

```bash
git add -A
git commit -m "fix: dashboard visual QA pass"
```

(Skip this commit if Step 2-4 found nothing to fix.)

---

## Self-Review Notes

- **Spec coverage:** header ✓ (Task 6), stat row ✓ (Tasks 3, 6), scan activity + guard breakdown ✓ (Tasks 4, 5, 6), footer nav links ✓ (Task 6, kept from original page), empty states (not connected / no site / never scanned) ✓ (Task 6), motion ✓ (Task 2 keyframes + Task 3/4 usage), brand tokens ✓ (Task 2), testing ✓ (Task 1 unit tests + Task 6/7 build and visual checks).
- **Placeholder scan:** none found — every step has real code or a real verification command.
- **Type consistency:** `GuardCounts`, `DashboardStats`, `ScanResultSummary` defined once in Task 1, imported (not redefined) everywhere else. `ActionForStats` shape matches what Prisma's `db.action.findMany({ include: { guardResult: true } })` actually returns (`guardResult: GuardResult | null`, which has an `outcome: string` field — matches).
