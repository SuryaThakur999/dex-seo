# Live Scan Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's scan-activity timeline update live (via polling, not a real push mechanism this app doesn't have) while a scan is queued/running, and disable "Scan now" during that window instead of silently no-oping.

**Architecture:** A new authenticated GET route (`/api/scan/status`) exposes the customer's recent `ScanJob` rows as JSON. A new client component (`LiveScanPanel`) polls that route every 3s only while the newest job is `queued`/`running`, replacing its local timeline state each tick, and calls `router.refresh()` once when the job finishes so the server-rendered stat cards and GrowthGuard breakdown pick up real new numbers without being polled themselves.

**Tech Stack:** Next.js 14 App Router (Route Handlers, `useRouter` from `next/navigation`), TypeScript, Prisma, Vitest (node environment). No new npm dependency.

## Global Constraints

- No schema changes, no new npm dependencies.
- Middleware's `isProtectedRoute` matcher covers `/api/scan` as an exact string only (not `/api/scan(.*)`) — the new `/api/scan/status` route is NOT middleware-covered, so it must check `auth()` inline itself and return 401 on its own.
- Polling stops the moment the newest job leaves `queued`/`running` — no polling for an idle dashboard, no indefinite retry on a failed fetch.
- "Scan now" disables and relabels ("Scan in progress") while a job is in flight; this closes a gap the `dashboard-finish` branch's final review flagged and deferred.
- Path alias `@/*` → `./src/*`.

---

### Task 1: Scan status API route

**Files:**
- Create: `src/app/api/scan/status/route.ts`
- Test: `src/app/api/scan/status/route.test.ts`

**Interfaces:**
- Produces: `GET` handler returning `{ jobs: { id: string; status: string; createdAt: Date; completedAt: Date | null; error: string | null }[] }` as JSON (Prisma `Date` fields serialize to ISO strings over the wire — Task 2's client code parses them back).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/scan/status/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    scanJob: { findMany: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

describe('GET /api/scan/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns 401 when the customer record is not found', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns the customer's own jobs, newest first, capped at 5", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust_1' });
    const jobs = [
      { id: 'job_2', status: 'running', createdAt: new Date('2026-01-02'), completedAt: null, error: null },
    ];
    (db.scanJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(jobs);

    const res = await GET();
    const body = await res.json();

    expect(db.scanJob.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust_1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, status: true, createdAt: true, completedAt: true, error: true },
    });
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].id).toBe('job_2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/app/api/scan/status/route.test.ts`
Expected: FAIL with "Cannot find module './route'" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/scan/status/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Unauthorized', { status: 401 });

  const jobs = await db.scanJob.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, status: true, createdAt: true, completedAt: true, error: true },
  });

  return NextResponse.json({ jobs });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/app/api/scan/status/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/scan/status/route.ts src/app/api/scan/status/route.test.ts
git commit -m "feat: add authenticated scan status polling endpoint"
```

---

### Task 2: LiveScanPanel component

**Files:**
- Modify: `src/components/dashboard/scan-activity.tsx` (export the existing local `ScanActivityJob` interface)
- Create: `src/components/dashboard/live-scan-panel.tsx`

**Interfaces:**
- Consumes: `ScanActivity` and its now-exported `ScanActivityJob` type from `@/components/dashboard/scan-activity`; `Button` from `@/components/ui/button`; `useRouter` from `next/navigation`.
- Produces: `LiveScanPanel` component with prop `{ initialJobs: ScanActivityJob[] }`.

- [ ] **Step 1: Export `ScanActivityJob` from scan-activity.tsx**

In `src/components/dashboard/scan-activity.tsx`, change:

```typescript
interface ScanActivityJob {
```

to:

```typescript
export interface ScanActivityJob {
```

(No other change to that file — this is a one-word addition, `export`, on the existing interface declaration.)

- [ ] **Step 2: Write the component**

```tsx
// src/components/dashboard/live-scan-panel.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScanActivity, type ScanActivityJob } from '@/components/dashboard/scan-activity';

const POLL_INTERVAL_MS = 3000;
const IN_FLIGHT_STATUSES = new Set(['queued', 'running']);

interface RawJob {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

function parseJobs(raw: RawJob[]): ScanActivityJob[] {
  return raw.map((job) => ({
    ...job,
    createdAt: new Date(job.createdAt),
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
  }));
}

export function LiveScanPanel({ initialJobs }: { initialJobs: ScanActivityJob[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inFlight = jobs.length > 0 && IN_FLIGHT_STATUSES.has(jobs[0].status);

  useEffect(() => {
    if (!inFlight) return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/scan/status');
        if (!res.ok) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return;
        }
        const data: { jobs: RawJob[] } = await res.json();
        const nextJobs = parseJobs(data.jobs);
        setJobs(nextJobs);

        const stillInFlight = nextJobs.length > 0 && IN_FLIGHT_STATUSES.has(nextJobs[0].status);
        if (!stillInFlight) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          router.refresh();
        }
      } catch {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [inFlight, router]);

  return (
    <div className="flex flex-col gap-4">
      <form action="/api/scan" method="post">
        <Button type="submit" variant="accent" disabled={inFlight}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {inFlight ? 'Scan in progress' : 'Scan now'}
        </Button>
      </form>
      <ScanActivity jobs={jobs} />
    </div>
  );
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: succeeds. (Client component with a timer and `fetch` — no jsdom/RTL infra exists in this repo, so `npm run build`'s type-check is the gate here; Task 4 covers live behavioral verification.)

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/scan-activity.tsx src/components/dashboard/live-scan-panel.tsx
git commit -m "feat: add LiveScanPanel with 3s status polling"
```

---

### Task 3: Wire LiveScanPanel into the dashboard page

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `LiveScanPanel` from `@/components/dashboard/live-scan-panel` (Task 2).

This task makes three changes to `src/app/dashboard/page.tsx`, in order. Read the current file first to locate each exact block — it was last rebuilt by the `dashboard-finish` plan and has this shape (imports, then the header, then the four state-branch blocks, then the stat-row/two-column section).

**Change A — remove the header's standalone "Scan now" form.** Currently the header renders:

```tsx
          {siteSelected && (
            <form action="/api/scan" method="post">
              <Button type="submit" variant="accent">
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Scan now
              </Button>
            </form>
          )}
```

Delete this block entirely — `LiveScanPanel` (added in Change C) now owns the scan-trigger button, placed next to the timeline instead of the header. The `RefreshCw` import becomes unused after this deletion; remove it from the `lucide-react` import line too (keep `FileSearch, Inbox, ShieldCheck, Coins`, drop `RefreshCw`).

**Change B — add a scan-trigger button to the "no scans yet" empty state.** Currently:

```tsx
      {siteSelected && !latestScanJob && (
        <Card className="mt-8">
          <CardContent className="py-10 text-sm text-muted-foreground">
            No scans yet. Hit &ldquo;Scan now&rdquo; above and Dex will crawl your site, find pages worth improving, and
            draft meta descriptions with GrowthGuard checking every one before it reaches you.
          </CardContent>
        </Card>
      )}
```

Replace with:

```tsx
      {siteSelected && !latestScanJob && (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-start gap-4 py-10">
            <p className="text-sm text-muted-foreground">
              No scans yet. Run one and Dex will crawl your site, find pages worth improving, and draft meta
              descriptions with GrowthGuard checking every one before it reaches you.
            </p>
            <form action="/api/scan" method="post">
              <Button type="submit" variant="accent">
                Scan now
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
```

(No live polling needed here — there's no job yet to poll for. The form POST triggers a full page reload via default browser navigation, which lands back on this same route with a real `queued` job now present, and `LiveScanPanel` takes over from there.)

**Change C — replace the `ScanActivity` usage with `LiveScanPanel`.** Currently, inside the `siteSelected && latestScanJob` block, the two-column grid has:

```tsx
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ScanActivity jobs={recentJobs} />
            <GuardBreakdown counts={guardCounts} />
          </div>
```

Change to:

```tsx
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <LiveScanPanel initialJobs={recentJobs} />
            <GuardBreakdown counts={guardCounts} />
          </div>
```

And update the imports at the top of the file: remove `import { ScanActivity } from '@/components/dashboard/scan-activity';` and add `import { LiveScanPanel } from '@/components/dashboard/live-scan-panel';`.

- [ ] **Step 1: Make Change A (remove header button, drop unused `RefreshCw` import)**

- [ ] **Step 2: Make Change B (add button to the empty-state card)**

- [ ] **Step 3: Make Change C (swap `ScanActivity` for `LiveScanPanel`, update imports)**

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all existing tests plus Task 1's 3 new tests pass (112 total).

- [ ] **Step 5: Run the build**

Run: `npm run build`
Expected: succeeds — this confirms the JSX wiring and that no import is left dangling (unused `RefreshCw`, missing `LiveScanPanel`, etc.).

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: wire LiveScanPanel into the dashboard, add scan button to empty state"
```

---

### Task 4: Live verification pass

**Files:** none (verification only — no code changes expected; if this task finds a bug, fix it and fold the fix into this task's commit).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Trigger a real scan and watch it poll**

Sign in as a real user with a connected site (or use the `/browse` skill against a session that already has one), click "Scan now," and confirm:
- The button immediately shows "Scan in progress" and is disabled.
- `$B network` (or the browser's Network tab) shows a request to `/api/scan/status` roughly every 3 seconds while the job is `queued`/`running`.
- Once the backing `ScanJob` transitions to `completed` (or `failed` — you can force this by checking the DB directly, or just wait for a real scan to finish), the button returns to "Scan now" (enabled), polling stops (no more `/api/scan/status` requests in the network log), and the stat cards / GrowthGuard breakdown reflect the new numbers without a manual reload.

- [ ] **Step 3: Verify the empty-state path**

For a site with zero scans ever (or a fresh test customer), confirm the "No scans yet" card now shows a working "Scan now" button, and clicking it does a full page reload landing back on `/dashboard` with the job now `queued` and `LiveScanPanel` visible.

- [ ] **Step 4: Fix anything found, then final commit if changes were made**

```bash
git add -A
git commit -m "fix: live scan status verification pass"
```

(Skip this commit if Steps 2-3 found nothing to fix.)

---

## Self-Review Notes

- **Spec coverage:** new status route ✓ (Task 1), 3s polling only while in-flight ✓ (Task 2), stop-and-refresh-once on completion ✓ (Task 2), button disable/relabel ✓ (Task 2 + Task 3 Change A/B), stat cards/guard breakdown refresh via `router.refresh()` not separate polling ✓ (Task 2), no new dependency ✓, testing per spec's Testing section ✓ (Task 1 unit tests, Task 4 manual verification).
- **Gap the spec didn't address, resolved here:** the original `dashboard-finish` layout put "Scan now" in the header, visible even with zero prior scans, but `ScanActivity`/the timeline only rendered after a first job existed. Simply wrapping "Scan now" inside `LiveScanPanel` and only rendering `LiveScanPanel` alongside the timeline (as the spec's Page Change section describes) would have deleted the ONLY way to trigger a first-ever scan from a fresh dashboard. Task 3's Change B closes that gap by giving the "no scans yet" empty state its own (non-polling, since there's nothing to poll yet) scan button — a pre-existing usability gap fixed as a side effect, not scope creep, since it would have been actively broken by this change otherwise.
- **Placeholder scan:** none found — every step has real code or a real verification command.
- **Type consistency:** `ScanActivityJob` defined once in `scan-activity.tsx` (now exported), imported by `live-scan-panel.tsx`, not redefined. The JSON-over-the-wire `RawJob` shape (dates as strings) is kept distinct from `ScanActivityJob` (dates as `Date`) and `parseJobs` is the single conversion point.
