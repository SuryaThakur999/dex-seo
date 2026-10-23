# Dashboard Information Architecture Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the dashboard Overview tab from ~16 blocks to at most 5 (Today, Fixes for your site, Competitors this week + Post ideas, Ask Dex), move all diagnostic/history content unchanged to the Analytics tab, fold the scan terminal into a header status line, move website-add into the site switcher, and fix the four named Studio/Competitors UI issues — all per `docs/superpowers/specs/2026-10-16-dashboard-information-architecture-design.md` (commit 7c16a5e, founder-lens approved).

**Architecture:** No new pages or routes beyond one small on-demand competitor-check endpoint. Mostly component-level restructuring inside the existing `src/app/dashboard/[websiteId]/page.tsx` (Overview/Analytics/Outcomes already exist as tabs via `DashboardTabs`). New presentational components (`TodayCard`, `PostIdeasCard`) are built from data already computed in `page.tsx` plus one new query (`ContentRecommendation`, top 3 `status: 'new'`). Existing stateful components (`LiveScanPanel`, `CompetitorWatchCard`, `EvidenceSourcePicker`) keep their internal state/hooks untouched and only change their rendered layout, to avoid touching working polling/game/retry logic.

**Tech Stack:** Next.js App Router (server components in `page.tsx`, client components for interactive pieces), Prisma/Postgres, Vitest + Testing Library, Tailwind, shadcn/radix `Select`/`Tabs`.

## Global Constraints

- Overview renders **at most 5 blocks**, in a fixed order (spec rule 1).
- Every Overview block has **one verb button** (spec rule 2); no block is a bare number.
- Each real count (pending reviews, competitor changes, post ideas, etc.) appears **once** on the whole page (spec rule 3).
- Diagnostics/history move to Analytics; results stay on Outcomes (unchanged) (spec rule 4).
- Every moved card keeps its **original classes, styles, effects, animations** — additive only, nothing deleted (spec rule 5 / AI rule 7).
- Mobile shows the same blocks, same order, one column (spec rule 6) — no new breakpoint-specific reordering.
- Tier 2 design rule applies: `emil-design-eng` always + `ui-ux-pro-max` + `apple-design` + `impeccable`, six-skill receipts, screenshots at 320/768/1280px for Overview, Analytics and Studio in the done message. Screenshots are blocked in this sandbox by the standing Clerk-login gap — note that explicitly, never skip silently.
- No new DB columns/migrations in this plan (spec needs none — `ContentRecommendation`, `Website.gscRefreshToken`, etc. already carry everything required).
- Never invent a fake "Check now" success — the new on-demand competitor-check endpoint must call the real `runCompetitorWatch` job, not a canned response.

## Known gap, flagged non-blocking

The spec says "The full board stays in Studio" for Post ideas (full `ContentRecommendation` list). **No such board exists anywhere in Studio today** — `db.contentRecommendation` is currently only read by id in `drafts/route.ts` and written by `run-research-job.ts`; nothing lists or renders it. Building a full recommendations board in Studio is a separate, larger feature (list UI, dismiss/convert actions, Studio layout changes) not authorized or scoped by this dispatch. This plan builds the Overview "Post ideas" top-3 teaser exactly as specified (topic, why-now, source date, "Write post" link into Studio) and does **not** invent a full Studio board. Flagged to god/overseer; build to spec as written for what the spec actually describes building, same pattern as the brand-voice task's CompetitorEntity gap.

---

### Task 1: Overview block-order constant

**Files:**
- Create: `src/lib/overview-layout.ts`
- Test: `src/lib/overview-layout.test.ts`

**Interfaces:**
- Produces: `OVERVIEW_BLOCKS: readonly OverviewBlockId[]`, `type OverviewBlockId`. Task 11 makes `page.tsx` map over this array to render Overview, so this constant is the actual enforced render order, not a decorative aside.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/overview-layout.test.ts
import { describe, expect, it } from 'vitest';
import { OVERVIEW_BLOCKS } from './overview-layout';

describe('OVERVIEW_BLOCKS', () => {
  it('has at most 5 blocks', () => {
    expect(OVERVIEW_BLOCKS.length).toBeLessThanOrEqual(5);
  });

  it('is exactly today, fixes-for-your-site, competitors-and-ideas, ask-dex in that order', () => {
    expect(OVERVIEW_BLOCKS).toEqual(['today', 'fixes-for-your-site', 'competitors-and-ideas', 'ask-dex']);
  });

  it('has no duplicate block ids', () => {
    expect(new Set(OVERVIEW_BLOCKS).size).toBe(OVERVIEW_BLOCKS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/overview-layout.test.ts`
Expected: FAIL — `Cannot find module './overview-layout'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/overview-layout.ts
// Dashboard IA rebuild (2026-10-16 spec, commit 7c16a5e): this is the one place that decides
// Overview's block count and order. page.tsx maps over this array to render Overview, so a
// test on this constant is a real enforcement of "at most 5 blocks, in this order" — not a
// decorative aside that could silently drift from what the page actually renders.
export const OVERVIEW_BLOCKS = ['today', 'fixes-for-your-site', 'competitors-and-ideas', 'ask-dex'] as const;
export type OverviewBlockId = (typeof OVERVIEW_BLOCKS)[number];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/overview-layout.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/overview-layout.ts src/lib/overview-layout.test.ts
git commit -m "feat(dashboard-ia): add Overview block-order constant"
```

---

### Task 2: Extract shared competitor-watch item logic

**Files:**
- Create: `src/lib/competitor-watch.ts`
- Modify: `src/app/api/client-profile/[id]/competitor-watch/route.ts`
- Test: `src/lib/competitor-watch.test.ts`

**Interfaces:**
- Produces: `buildCompetitorWatchItems(evidence: EvidenceRow[], nameById: Map<string, string>): CompetitorWatchItem[]` and `hasRealPriorChange(observedMetrics: unknown): boolean`.
- Consumes: nothing new — same shape the route already builds inline.

Needed so Task 6 (Today card's competitor-change count) and the route use the exact same "what counts as a real change" rule instead of two independently-maintained copies.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/competitor-watch.test.ts
import { describe, expect, it } from 'vitest';
import { buildCompetitorWatchItems, hasRealPriorChange } from './competitor-watch';

describe('hasRealPriorChange', () => {
  it('is false for a first-observation baseline row (priorContentHash: null)', () => {
    expect(hasRealPriorChange({ priorContentHash: null })).toBe(false);
  });
  it('is true once a prior hash exists', () => {
    expect(hasRealPriorChange({ priorContentHash: 'abc123' })).toBe(true);
  });
  it('is false for missing/malformed observedMetrics', () => {
    expect(hasRealPriorChange(null)).toBe(false);
    expect(hasRealPriorChange([])).toBe(false);
  });
});

describe('buildCompetitorWatchItems', () => {
  it('excludes baseline rows and maps the rest to CompetitorWatchItem', () => {
    const nameById = new Map([['c1', 'Acme Co']]);
    const evidence = [
      { id: 'e1', entityId: 'c1', canonicalUrl: 'https://acme.test', excerpt: 'New pricing.', retrievedAt: new Date('2026-10-14'), observedMetrics: { priorContentHash: 'old' } },
      { id: 'e2', entityId: 'c1', canonicalUrl: 'https://acme.test/first', excerpt: 'Baseline.', retrievedAt: new Date('2026-10-01'), observedMetrics: { priorContentHash: null } },
    ];
    const items = buildCompetitorWatchItems(evidence, nameById);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'e1', competitorName: 'Acme Co', canonicalUrl: 'https://acme.test', excerpt: 'New pricing.' });
    expect(items[0].retrievedAt).toBe('2026-10-14T00:00:00.000Z');
  });

  it('falls back to "Unknown competitor" for an entityId not in the map', () => {
    const items = buildCompetitorWatchItems(
      [{ id: 'e1', entityId: 'missing', canonicalUrl: 'https://x.test', excerpt: 'X', retrievedAt: new Date('2026-10-14'), observedMetrics: { priorContentHash: 'x' } }],
      new Map()
    );
    expect(items[0].competitorName).toBe('Unknown competitor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/competitor-watch.test.ts`
Expected: FAIL — `Cannot find module './competitor-watch'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/competitor-watch.ts
export interface CompetitorWatchItem {
  id: string;
  competitorName: string;
  canonicalUrl: string;
  excerpt: string;
  retrievedAt: string;
}

interface EvidenceRow {
  id: string;
  entityId: string;
  canonicalUrl: string;
  excerpt: string;
  retrievedAt: Date;
  observedMetrics: unknown;
}

// Task 19's own first-observation baseline rows (observedMetrics.priorContentHash: null) never
// represent a real change — excluded here so the route's query result and this card's "what
// changed" reading stay a single, shared definition instead of two copies that can drift.
export function hasRealPriorChange(observedMetrics: unknown): boolean {
  return Boolean(
    observedMetrics && typeof observedMetrics === 'object' && !Array.isArray(observedMetrics) &&
    (observedMetrics as { priorContentHash?: unknown }).priorContentHash != null
  );
}

export function buildCompetitorWatchItems(evidence: EvidenceRow[], nameById: Map<string, string>): CompetitorWatchItem[] {
  return evidence
    .filter((e) => hasRealPriorChange(e.observedMetrics))
    .map((e) => ({
      id: e.id,
      competitorName: nameById.get(e.entityId) ?? 'Unknown competitor',
      canonicalUrl: e.canonicalUrl,
      excerpt: e.excerpt,
      retrievedAt: e.retrievedAt.toISOString(),
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/competitor-watch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire the route to the shared function**

Modify `src/app/api/client-profile/[id]/competitor-watch/route.ts`: replace the inline `hasRealPriorChange` function and the `.filter(...).map(...)` block with imports from `@/lib/competitor-watch` and a call to `buildCompetitorWatchItems(evidence, nameById)`. Delete the now-duplicate local `hasRealPriorChange` and the `CompetitorWatchItem` interface (re-export the one from the lib instead, so Task 6's Today-card count import stays type-compatible).

Run: `npx vitest run src/app/api/client-profile` — all existing tests for this route must stay green (no behavior change, pure extraction).

- [ ] **Step 6: Commit**

```bash
git add src/lib/competitor-watch.ts src/lib/competitor-watch.test.ts src/app/api/client-profile/\[id\]/competitor-watch/route.ts
git commit -m "refactor(dashboard-ia): extract shared competitor-watch item builder"
```

---

### Task 3: On-demand competitor check endpoint

**Files:**
- Create: `src/app/api/client-profile/[id]/competitor-watch/check-now/route.ts`
- Test: `src/app/api/client-profile/[id]/competitor-watch/check-now/route.test.ts`

**Interfaces:**
- Produces: `POST` handler returning `{ changed: number }` on success. Consumed by Task 4's "Check now" button.
- Consumes: `runCompetitorWatch(clientProfileId: string)` from `@/lib/research/competitor-watch-job` (same function the weekly cron already calls) and the same `requireOwnedProfile` ownership pattern the existing GET route uses.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/client-profile/[id]/competitor-watch/check-now/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { clientProfile: { findFirst: vi.fn() } } }));
vi.mock('@/lib/research/competitor-watch-job', () => ({ runCompetitorWatch: vi.fn() }));
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { runCompetitorWatch } from '@/lib/research/competitor-watch-job';
import { POST } from './route';

describe('POST /api/client-profile/[id]/competitor-watch/check-now', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401s when unauthenticated', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const res = await POST(new Request('http://x') as never, { params: { id: 'profile_1' } });
    expect(res.status).toBe(401);
  });

  it('403s when the profile is not owned by this customer', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(null);
    const res = await POST(new Request('http://x') as never, { params: { id: 'profile_1' } });
    expect(res.status).toBe(403);
    expect(runCompetitorWatch).not.toHaveBeenCalled();
  });

  it('runs the real job for an owned profile and returns its real changed count', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue({ id: 'profile_1' } as never);
    vi.mocked(runCompetitorWatch).mockResolvedValue({ changed: ['e1', 'e2'] } as never);
    const res = await POST(new Request('http://x') as never, { params: { id: 'profile_1' } });
    expect(runCompetitorWatch).toHaveBeenCalledWith('profile_1');
    expect(await res.json()).toEqual({ changed: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/client-profile/\[id\]/competitor-watch/check-now`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/app/api/client-profile/[id]/competitor-watch/check-now/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runCompetitorWatch } from '@/lib/research/competitor-watch-job';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profile = await db.clientProfile.findFirst({ where: { id: params.id, customer: { clerkUserId: userId } } });
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const result = await runCompetitorWatch(params.id);
  return NextResponse.json({ changed: result.changed.length });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/client-profile/\[id\]/competitor-watch/check-now`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/client-profile/\[id\]/competitor-watch/check-now
git commit -m "feat(dashboard-ia): add on-demand competitor check endpoint"
```

---

### Task 4: Competitors empty-state fix

**Files:**
- Modify: `src/components/dashboard/competitor-watch-card.tsx`
- Modify: `src/components/dashboard/competitor-watch-card.test.tsx`

**Interfaces:**
- Consumes: `POST /api/client-profile/{id}/competitor-watch/check-now` (Task 3).
- No prop signature change — same `{ clientProfileId, websiteId }`.

- [ ] **Step 1: Write the failing test (extend existing file)**

Add to `competitor-watch-card.test.tsx`:

```typescript
  it('empty state shows the exact copy and Add competitors / Check now actions, no tall empty box', async () => {
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();
    expect(screen.getByText('No changes yet. Dex checks every Monday.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add competitors' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Competitor watch' })).not.toHaveClass('min-h-24');
  });

  it('Check now calls the real check-now endpoint and refetches on success', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('/check-now') ? Promise.resolve({ ok: true, json: async () => ({ changed: 1 }) }) : Promise.resolve(response([]))
    );
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/client-profile/profile_1/competitor-watch/check-now', { method: 'POST' });
  });
```

Add `fireEvent` to the existing `@testing-library/react` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/competitor-watch-card.test.tsx`
Expected: FAIL — "No changes yet. Dex checks every Monday." text and "Check now" button don't exist yet.

- [ ] **Step 3: Write minimal implementation**

Replace the empty-state branch and `min-h-24` wrapper in `competitor-watch-card.tsx`:

```tsx
export function CompetitorWatchCard({ clientProfileId, websiteId }: { clientProfileId: string; websiteId: string }) {
  const [items, setItems] = useState<CompetitorWatchItem[] | null>(null);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function load(signal?: AbortSignal) {
    try {
      const response = await fetch(`/api/client-profile/${encodeURIComponent(clientProfileId)}/competitor-watch`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Competitor watch request failed');
      const data: { items: CompetitorWatchItem[] } = await response.json();
      setItems(data.items);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [clientProfileId]);

  async function handleCheckNow() {
    if (checking) return;
    setChecking(true);
    try {
      await fetch(`/api/client-profile/${encodeURIComponent(clientProfileId)}/competitor-watch/check-now`, { method: 'POST' });
      await load();
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card role="region" aria-label="Competitor watch">
      <CardHeader>
        <CardTitle className="text-base font-medium">Competitors this week</CardTitle>
      </CardHeader>
      <CardContent className={items === null && !error ? 'min-h-24 pt-0' : 'pt-0'}>
        {error && <p role="alert" className="text-sm text-foreground">{"Couldn't load competitor changes. We'll try again shortly."}</p>}
        {items === null && !error && <p role="status" className="text-sm text-muted-foreground">Loading competitor changes</p>}
        {items?.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">No changes yet. Dex checks every Monday.</p>
            <div className="flex flex-wrap gap-3">
              <a href="/settings" className="text-xs font-medium text-accent underline-offset-4 hover:underline">Add competitors</a>
              <button type="button" onClick={handleCheckNow} disabled={checking} className="text-xs font-medium text-accent underline-offset-4 hover:underline disabled:opacity-50">
                {checking ? 'Checking…' : 'Check now'}
              </button>
            </div>
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{item.competitorName}</span>
                  <time dateTime={item.retrievedAt} className="text-xs text-muted-foreground">{dateFormatter.format(new Date(item.retrievedAt))}</time>
                </div>
                <p className="text-sm text-muted-foreground" title={item.canonicalUrl}>{item.excerpt}</p>
                <a
                  href={`/studio?websiteId=${encodeURIComponent(websiteId)}&topic=${encodeURIComponent(`Respond to ${item.competitorName}'s recent site update`)}&sourceEvidenceId=${encodeURIComponent(item.id)}`}
                  className="mt-1 w-fit text-xs font-medium text-accent underline-offset-4 hover:underline"
                >
                  Respond with a post
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

(`CompetitorWatchItem` import now comes from `@/lib/competitor-watch` per Task 2.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/competitor-watch-card.test.tsx`
Expected: PASS (all prior + 2 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/competitor-watch-card.tsx src/components/dashboard/competitor-watch-card.test.tsx
git commit -m "fix(dashboard-ia): Competitors empty state matches spec, adds Check now"
```

---

### Task 5: Extract `useDailyMission` hook

**Files:**
- Create: `src/hooks/use-daily-mission.ts`
- Create: `src/hooks/use-daily-mission.test.tsx`
- Modify: `src/components/dashboard/daily-mission-card.tsx`

**Interfaces:**
- Produces: `useDailyMission(websiteId: string): { mission: Mission | null; error: boolean }`. Task 6's `TodayCard` consumes this directly instead of re-fetching.
- Pure refactor: `DailyMissionCard`'s own rendered output and `daily-mission-card.test.tsx` must not change at all.

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/use-daily-mission.test.tsx
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyMission } from './use-daily-mission';

const fetchMock = vi.fn();
function Harness({ websiteId }: { websiteId: string }) {
  const { mission, error } = useDailyMission(websiteId);
  if (error) return <p role="alert">error</p>;
  if (!mission) return <p role="status">loading</p>;
  return <p>{mission.title}</p>;
}

describe('useDailyMission', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('fetches the encoded website id and resolves the mission', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ title: 'Start a New Audit', description: 'd', cta: 'New Scan', ctaHref: '#scan-control', icon: '🚀' }) });
    render(<Harness websiteId="site /?" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/daily-mission?websiteId=site%20%2F%3F', expect.any(Object));
    expect(screen.getByText('Start a New Audit')).toBeInTheDocument();
  });

  it('sets error on a failed fetch', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<Harness websiteId="site_1" />);
    await act(async () => {});
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/use-daily-mission.test.tsx`
Expected: FAIL — `Cannot find module './use-daily-mission'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/hooks/use-daily-mission.ts
import { useEffect, useState } from 'react';
import type { Mission } from '@/lib/daily-mission-logic';

export function useDailyMission(websiteId: string): { mission: Mission | null; error: boolean } {
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setMission(null);
    setError(false);

    async function load() {
      try {
        const response = await fetch(`/api/dashboard/daily-mission?websiteId=${encodeURIComponent(websiteId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Daily mission request failed');
        const data: Mission = await response.json();
        if (!disposed) setMission(data);
      } catch {
        if (!disposed) setError(true);
      }
    }

    void load();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [websiteId]);

  return { mission, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/use-daily-mission.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Update `DailyMissionCard` to use the hook, verify its existing tests still pass unchanged**

```tsx
// src/components/dashboard/daily-mission-card.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDailyMission } from '@/hooks/use-daily-mission';

export function DailyMissionCard({ websiteId }: { websiteId: string }) {
  const { mission, error } = useDailyMission(websiteId);

  return (
    <Card role="region" aria-label="Daily mission">
      <CardContent className="flex min-h-24 flex-wrap items-center justify-between gap-4 py-5">
        {error ? (
          <p role="alert" className="text-sm text-foreground">{"Couldn't load your next mission. Refresh to try again."}</p>
        ) : mission ? (
          <>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">{mission.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{mission.description}</p>
            </div>
            <Button asChild variant="accent" className="h-11 shrink-0">
              <Link href={mission.ctaHref}>{mission.cta}</Link>
            </Button>
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">Loading your next mission</p>
        )}
      </CardContent>
    </Card>
  );
}
```

Run: `npx vitest run src/components/dashboard/daily-mission-card.test.tsx`
Expected: PASS, all 5 existing tests unchanged (pure refactor, zero new assertions needed here).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-daily-mission.ts src/hooks/use-daily-mission.test.tsx src/components/dashboard/daily-mission-card.tsx
git commit -m "refactor(dashboard-ia): extract useDailyMission hook for reuse in TodayCard"
```

---

### Task 6: `TodayCard`

**Files:**
- Create: `src/components/dashboard/today-card.tsx`
- Create: `src/components/dashboard/today-card-types.ts`
- Create: `src/components/dashboard/today-card.test.tsx`

**Interfaces:**
- Consumes: `useDailyMission` (Task 5) for the mission title/button; three real counts and a `summary: React.ReactNode` passed in as props from `page.tsx` (Task 11).
- Produces: `TodayCard({ websiteId, pendingReviewCount, competitorChangeCount, postIdeaCount, summary }: TodayCardProps)`.

```typescript
export interface TodayCardProps {
  websiteId: string;
  /** Real count of status:'pending' Actions — same source as computeDashboardStats().pendingCount. */
  pendingReviewCount: number;
  /** Real count of this week's detected competitor changes — same source CompetitorWatchCard reads. */
  competitorChangeCount: number;
  /** Real count of status:'new' ContentRecommendation rows for this website. */
  postIdeaCount: number;
  /** Pre-rendered AI summary sentence (server component, awaited in page.tsx before this renders). */
  summary: React.ReactNode;
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/today-card.test.tsx
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayCard } from './today-card';

const fetchMock = vi.fn();
const mission = { icon: '🚀', title: 'Start a New Audit', description: 'd', cta: 'New Scan', ctaHref: '#scan-control' };

describe('TodayCard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => mission });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders the summary subtitle and the mission button', async () => {
    render(<TodayCard websiteId="site_1" pendingReviewCount={0} competitorChangeCount={0} postIdeaCount={0} summary={<p>3 pages flagged.</p>} />);
    expect(screen.getByText('3 pages flagged.')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByRole('link', { name: 'New Scan' })).toHaveAttribute('href', '#scan-control');
  });

  it('shows up to 3 waiting-for-you rows, one per nonzero count, and nothing for a zero count', async () => {
    render(<TodayCard websiteId="site_1" pendingReviewCount={11} competitorChangeCount={2} postIdeaCount={0} summary={null} />);
    await act(async () => {});
    expect(screen.getByText('11 reviews waiting')).toBeInTheDocument();
    expect(screen.getByText('2 competitor changes')).toBeInTheDocument();
    expect(screen.queryByText(/post idea/)).not.toBeInTheDocument();
  });

  it('renders nothing in the waiting list when all three counts are zero', async () => {
    render(<TodayCard websiteId="site_1" pendingReviewCount={0} competitorChangeCount={0} postIdeaCount={0} summary={null} />);
    await act(async () => {});
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/today-card.test.tsx`
Expected: FAIL — `Cannot find module './today-card'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/components/dashboard/today-card-types.ts
import type { ReactNode } from 'react';

export interface TodayCardProps {
  websiteId: string;
  pendingReviewCount: number;
  competitorChangeCount: number;
  postIdeaCount: number;
  summary: ReactNode;
}
```

```tsx
// src/components/dashboard/today-card.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDailyMission } from '@/hooks/use-daily-mission';
import type { TodayCardProps } from './today-card-types';

export function TodayCard({ websiteId, pendingReviewCount, competitorChangeCount, postIdeaCount, summary }: TodayCardProps) {
  const { mission, error } = useDailyMission(websiteId);

  const rows = [
    pendingReviewCount > 0 ? { href: '/review', label: `${pendingReviewCount} review${pendingReviewCount === 1 ? '' : 's'} waiting` } : null,
    competitorChangeCount > 0 ? { href: '#competitors-and-ideas', label: `${competitorChangeCount} competitor change${competitorChangeCount === 1 ? '' : 's'}` } : null,
    postIdeaCount > 0 ? { href: '#competitors-and-ideas', label: `${postIdeaCount} post idea${postIdeaCount === 1 ? '' : 's'}` } : null,
  ].filter((r): r is { href: string; label: string } => r !== null);

  return (
    <Card role="region" aria-label="Today">
      <CardContent className="flex flex-col gap-4 py-5">
        {summary && <div className="text-sm text-muted-foreground">{summary}</div>}
        {rows.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <li key={row.label}>
                <a href={row.href} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">{row.label}</a>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          {error ? (
            <p role="alert" className="text-sm text-foreground">{"Couldn't load your next mission. Refresh to try again."}</p>
          ) : mission ? (
            <>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">{mission.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{mission.description}</p>
              </div>
              <Button asChild variant="accent" className="h-11 shrink-0">
                <Link href={mission.ctaHref}>{mission.cta}</Link>
              </Button>
            </>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">Loading your next mission</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

(`today-card-types.ts` is split out so Task 11's server-component `page.tsx` can import the prop type without pulling in the `'use client'` component itself.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/today-card.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/today-card.tsx src/components/dashboard/today-card-types.ts src/components/dashboard/today-card.test.tsx
git commit -m "feat(dashboard-ia): add TodayCard — merged Today block"
```

---

### Task 7: `PostIdeasCard`

**Files:**
- Create: `src/components/dashboard/post-ideas-card.tsx`
- Create: `src/components/dashboard/post-ideas-card.test.tsx`

**Interfaces:**
- Produces: `PostIdeasCard({ websiteId, ideas }: { websiteId: string; ideas: PostIdea[] })`, `export interface PostIdea { id: string; topic: string; whyNow: string; sourceDate: string }`. Pure presentational — no fetch (page.tsx queries `ContentRecommendation` server-side, same pattern every other Overview block already uses).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/post-ideas-card.test.tsx
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PostIdeasCard } from './post-ideas-card';

afterEach(cleanup);

describe('PostIdeasCard', () => {
  it('shows an honest empty state with no ideas', () => {
    render(<PostIdeasCard websiteId="site_1" ideas={[]} />);
    expect(screen.getByText(/No post ideas yet/)).toBeInTheDocument();
  });

  it('lists each idea with topic, why-now, and a Write post link into Studio', () => {
    render(
      <PostIdeasCard
        websiteId="site_1"
        ideas={[{ id: 'rec_1', topic: 'New hiring trends in logistics', whyNow: 'Competitor published on this topic this week.', sourceDate: '2026-10-14T00:00:00.000Z' }]}
      />
    );
    expect(screen.getByText('New hiring trends in logistics')).toBeInTheDocument();
    expect(screen.getByText('Competitor published on this topic this week.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Write post' });
    expect(link).toHaveAttribute('href', expect.stringContaining('sourceRecommendationId=rec_1'));
    expect(link).toHaveAttribute('href', expect.stringContaining('websiteId=site_1'));
  });

  it('caps the list at 3 ideas', () => {
    const ideas = Array.from({ length: 5 }, (_, i) => ({ id: `rec_${i}`, topic: `Topic ${i}`, whyNow: 'why', sourceDate: '2026-10-14T00:00:00.000Z' }));
    render(<PostIdeasCard websiteId="site_1" ideas={ideas} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/post-ideas-card.test.tsx`
Expected: FAIL — `Cannot find module './post-ideas-card'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/dashboard/post-ideas-card.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface PostIdea {
  id: string;
  topic: string;
  whyNow: string;
  sourceDate: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function PostIdeasCard({ websiteId, ideas }: { websiteId: string; ideas: PostIdea[] }) {
  const top = ideas.slice(0, 3);

  return (
    <Card role="region" aria-label="Post ideas">
      <CardHeader>
        <CardTitle className="text-base font-medium">Post ideas</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">No post ideas yet. Dex surfaces these as it finds real opportunities.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {top.map((idea) => (
              <li key={idea.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{idea.topic}</span>
                  <time dateTime={idea.sourceDate} className="text-xs text-muted-foreground">{dateFormatter.format(new Date(idea.sourceDate))}</time>
                </div>
                <p className="text-sm text-muted-foreground">{idea.whyNow}</p>
                <a
                  href={`/studio?websiteId=${encodeURIComponent(websiteId)}&topic=${encodeURIComponent(idea.topic)}&sourceRecommendationId=${encodeURIComponent(idea.id)}`}
                  className="mt-1 w-fit text-xs font-medium text-accent underline-offset-4 hover:underline"
                >
                  Write post
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/post-ideas-card.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/post-ideas-card.tsx src/components/dashboard/post-ideas-card.test.tsx
git commit -m "feat(dashboard-ia): add PostIdeasCard — top-3 Post ideas teaser"
```

---

### Task 8: `LiveScanPanel` — collapse to a header status line at rest

**Files:**
- Modify: `src/components/dashboard/live-scan-panel.tsx`
- Modify: `src/components/dashboard/live-scan-panel.test.tsx`

**Interfaces:**
- No prop signature change. All existing state/hooks (`jobs`, `logLines`, polling, cancel, crawl runner, game invite) stay byte-for-byte unchanged — only the returned JSX changes.
- Produces: an `id="scan-control"` slim status row, rendered instead of the always-mounted `<ScanActivity>` card, so `computeNextMission`'s `ctaHref: '#scan-control'` still resolves to a real, visible, clickable element.
- The full `<ScanActivity>` job-history card moves to Analytics in Task 11 (spec rule 4: history lives on Analytics) — this task removes it from `LiveScanPanel`'s own render, Task 11 re-mounts it unchanged in `page.tsx`'s `analytics` section.

- [ ] **Step 1: Write the failing test (extend existing file)**

Add to `live-scan-panel.test.tsx` (after reading its current fixtures/helpers to match its existing render/mock conventions):

```typescript
  it('at rest, shows a slim "Last checked … · Check again" status line with id="scan-control" instead of the job-history card', () => {
    render(<LiveScanPanel websiteId="site_1" initialJobs={[{ id: 'j1', status: 'completed', createdAt: new Date('2026-10-14'), completedAt: new Date('2026-10-14'), error: null, resultSummary: { pagesScanned: 10, pagesFlagged: 2, draftsCreated: 1, errors: [] } }]} opportunitiesFoundCount={2} draftsReadyCount={1} previewMode />);
    const status = document.getElementById('scan-control');
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent(/Last checked/);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    expect(screen.queryByText('Scan now')).not.toBeInTheDocument();
  });

  it('expands the full terminal while a scan is in flight, still inside #scan-control', () => {
    render(<LiveScanPanel websiteId="site_1" initialJobs={[{ id: 'j1', status: 'running', createdAt: new Date(), completedAt: null, error: null, resultSummary: null }]} opportunitiesFoundCount={0} draftsReadyCount={0} previewMode />);
    expect(document.getElementById('scan-control')).toContainElement(screen.getByText('Live activity'));
  });
```

(`toContainElement` needs `@testing-library/jest-dom`'s matcher, already used elsewhere in this suite — confirm via existing `expect.extend` setup before adding; if not globally registered, import it in this file the same way other dashboard test files do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/live-scan-panel.test.tsx`
Expected: FAIL — no element with id `scan-control` text "Last checked", "Check again" button not found.

- [ ] **Step 3: Write minimal implementation**

Replace `live-scan-panel.tsx`'s return statement. Keep every hook/handler above it (lines 92–240 in the current file) completely unchanged; only the JSX from `return (` onward changes:

```tsx
  const lastCheckedLabel = latestJob
    ? `Last checked ${formatRelativeTime(latestJob.completedAt ?? latestJob.createdAt)}`
    : 'No scans yet';

  return (
    <div id="scan-control" className="scroll-mt-6">
      {!inFlight && !showFullReport ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{lastCheckedLabel}</span>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={handleScanNow} className="font-medium text-accent underline-offset-4 hover:underline">
            Check again
          </button>
          {queuedTooLong && <span>{QUEUE_DELAY_MESSAGE}</span>}
          {latestFailed && (
            <span className="text-destructive">
              Last scan failed{latestFailed.error ? `: ${latestFailed.error}` : ''}.
              {canExpandReport && (
                <>
                  {' '}
                  <button type="button" onClick={() => setShowFullReport(true)} className="font-medium underline-offset-4 hover:underline">
                    Expand scan report
                  </button>
                </>
              )}
            </span>
          )}
          {latestCancelled && (
            <span>
              Scan cancelled{latestCancelledSummary ? ` — ${latestCancelledSummary.pagesScanned} pages checked before stopping.` : '.'}
              {canExpandReport && (
                <>
                  {' '}
                  <button type="button" onClick={() => setShowFullReport(true)} className="font-medium underline-offset-4 hover:underline">
                    Expand scan report
                  </button>
                </>
              )}
            </span>
          )}
          {showReceipt && latestCompletedSummary && (
            <>
              <a href="#findings" className="font-medium text-accent underline-offset-4 hover:underline">View opportunities</a>
              <button type="button" onClick={() => setShowFullReport(true)} className="font-medium underline-offset-4 hover:underline">Expand scan report</button>
            </>
          )}
        </div>
      ) : (
        <Card className="dex-app-terminal relative overflow-hidden">
          {inFlight && !reduce && <BorderBeam colorFrom="var(--accent)" colorTo="var(--dex-app-warning, #ffb020)" />}
          {inFlight && reduce && (
            <div className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-accent" aria-hidden="true" />
          )}
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle ref={liveActivityHeadingRef} tabIndex={-1} className="text-base font-medium focus:outline-none">
              Live activity
            </CardTitle>
            {inFlight && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{jobs[0]?.status === 'queued' ? 'Queued' : 'Running'}</Badge>
                {canCancel && (
                  <Button type="button" variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? 'Cancelling…' : 'Cancel scan'}
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            <ScanStageBreadcrumb lines={logLines} status={latestJob?.status ?? 'queued'} />
            <ScanTerminal lines={logLines} running={inFlight} />
            {!inFlight && logLines.length > 0 && (
              <button type="button" onClick={() => setShowFullReport(false)} className="self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Collapse
              </button>
            )}
            {inFlight && gameOpen && (
              <CrawlRunner onExit={() => { setGameOpen(false); liveActivityHeadingRef.current?.focus(); }} />
            )}
            {inFlight && inviteEligible && !gameOpen && !gameInviteDismissed && gamePreference === 'ask' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <GameController size={16} weight="regular" aria-hidden="true" />
                    Want to play while I work?
                  </p>
                  <p className="text-xs text-muted-foreground">Explore the web with a mini crawler, collect signals and uncover hidden paths.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="accent" size="sm" onClick={() => setGameOpen(true)}>Launch Crawl Runner</Button>
                  <button type="button" onClick={() => setGameInviteDismissed(true)} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    Watch scan
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

Add `formatRelativeTime` to the existing `@/lib/dashboard-stats` import line at the top of the file (it already imports `parseScanResultSummary` from there). Remove the now-unused `ScanActivity` import and `headerAction`/`statusMessage` JSX that used to render it — `ScanActivity` itself is not deleted (Task 11 imports it directly into `page.tsx`'s Analytics section instead).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/live-scan-panel.test.tsx`
Expected: PASS — all prior tests plus the 2 new ones. Re-read every pre-existing test in this file first and confirm none asserted on the old `<ScanActivity>` card or its "Scan now" button text living inside `LiveScanPanel`; update any that did to match the new slim-line/"Check again" copy (same reasoning as the brand-voice task's "pre-existing tests can encode old behavior" lesson — these are expected, deliberate updates, not regressions).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/live-scan-panel.tsx src/components/dashboard/live-scan-panel.test.tsx
git commit -m "feat(dashboard-ia): collapse LiveScanPanel to a header status line at rest"
```

---

### Task 9: Site switcher — "Add website"

**Files:**
- Modify: `src/components/app-shell/site-switcher.tsx`
- Modify: `src/components/app-shell/site-switcher.test.tsx`
- Modify: `src/components/app-shell/utility-bar.tsx`

**Interfaces:**
- New optional prop on `SiteSwitcher`: `showAddWebsite?: boolean; gscConnected?: boolean`. Default `false` — Studio's and Settings' existing `<SiteSwitcher>` call sites are untouched and keep today's behavior exactly.
- When `true`, renders a trailing "+ Add website" control that reveals `WebsiteEntryPanel` inline (normal document flow, no portal/overlay — no new UI-primitive dependency needed for one infrequent action).

- [ ] **Step 1: Write the failing test (extend existing file)**

```tsx
  it('shows an Add website control that reveals WebsiteEntryPanel inline when showAddWebsite is true', () => {
    render(<SiteSwitcher websites={[{ id: '1', url: 'a.test' }]} currentWebsiteId="1" showAddWebsite gscConnected />);
    expect(screen.queryByText('What website should Dex check?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    expect(screen.getByText('What website should Dex check?')).toBeInTheDocument();
  });

  it('does not show an Add website control when showAddWebsite is false or omitted', () => {
    render(<SiteSwitcher websites={[{ id: '1', url: 'a.test' }]} currentWebsiteId="1" />);
    expect(screen.queryByRole('button', { name: 'Add website' })).not.toBeInTheDocument();
  });
```

Add `fireEvent` to the existing import if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/app-shell/site-switcher.test.tsx`
Expected: FAIL — "Add website" button not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/app-shell/site-switcher.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { WebsiteEntryPanel } from '@/components/dashboard/website-entry-panel';

export function SiteSwitcher({
  websites,
  currentWebsiteId,
  profileName,
  hrefPattern = '/dashboard/{id}',
  showAddWebsite = false,
  gscConnected = false,
}: {
  websites: { id: string; url: string; profileName?: string }[];
  currentWebsiteId: string;
  profileName?: string;
  hrefPattern?: string;
  /** Dashboard IA rebuild (2026-10-16 spec): only the dashboard header instance sets this —
   *  Studio's and Settings' own SiteSwitcher calls omit it and keep today's behavior. */
  showAddWebsite?: boolean;
  gscConnected?: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const currentWebsite = websites.find((site) => site.id === currentWebsiteId);
  const currentLabel = currentWebsite?.profileName ?? profileName;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select value={currentWebsiteId} onValueChange={(id) => router.push(hrefPattern.replace('{id}', encodeURIComponent(id)))}>
          <SelectTrigger aria-label="Switch website" className="min-w-0 max-w-[160px] border-[var(--dex-app-border-strong)] text-left shadow-none data-[size=default]:h-11 sm:max-w-[260px]">
            <SelectValue className="min-w-0">
              <span className="block min-w-0">
                {currentLabel && <span className="block truncate text-xs font-medium">{currentLabel}</span>}
                <span className="block truncate font-mono text-xs text-muted-foreground">{currentWebsite?.url}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="max-w-[calc(100vw-2rem)]">
            {websites.map((site) => {
              const label = site.profileName ?? profileName;
              return (
                <SelectItem key={site.id} value={site.id} textValue={`${label ?? ''} ${site.url}`} className="min-h-11 [&>span:last-child]:min-w-0">
                  <span className="block min-w-0">
                    {label && <span className="block truncate text-xs font-medium">{label}</span>}
                    <span className="block truncate font-mono text-xs text-muted-foreground">{site.url}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {showAddWebsite && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen((v) => !v)}>
            {addOpen ? 'Cancel' : 'Add website'}
          </Button>
        )}
      </div>
      {showAddWebsite && addOpen && (
        <WebsiteEntryPanel currentWebsiteId={currentWebsiteId} gscConnected={gscConnected} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/app-shell/site-switcher.test.tsx`
Expected: PASS — all prior + 2 new tests.

- [ ] **Step 5: `UtilityBar` always offers Add-website on the dashboard, even with one website**

Modify `src/components/app-shell/utility-bar.tsx`:

```tsx
export function UtilityBar({
  websiteUrl,
  gscConnected,
  lastRefresh,
  websites,
  currentWebsiteId,
  profileName,
  switcherHrefPattern,
  showAddWebsite = false,
}: {
  websiteUrl: string;
  gscConnected: boolean;
  lastRefresh: Date | null;
  websites?: { id: string; url: string }[];
  currentWebsiteId?: string;
  profileName?: string;
  switcherHrefPattern?: string;
  showAddWebsite?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3">
      <div className="flex min-w-0 items-center gap-3">
        {websites && currentWebsiteId && (websites.length > 1 || showAddWebsite) ? (
          <SiteSwitcher
            websites={websites}
            currentWebsiteId={currentWebsiteId}
            profileName={profileName}
            hrefPattern={switcherHrefPattern}
            showAddWebsite={showAddWebsite}
            gscConnected={gscConnected}
          />
        ) : (
          <span className="truncate font-mono text-sm font-medium text-foreground">{websiteUrl}</span>
        )}
        {/* ...unchanged GSC badge + lastRefresh below... */}
```

(Rest of the component body is unchanged — only the prop list and the switcher-vs-span condition change.)

Run: `npx vitest run src/components/app-shell` — confirm no existing test in this directory breaks (there is no dedicated `UtilityBar` test file today); full confirmation happens in Task 11's exit-gate full suite run.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-shell/site-switcher.tsx src/components/app-shell/site-switcher.test.tsx src/components/app-shell/utility-bar.tsx
git commit -m "feat(dashboard-ia): move website-add into the site switcher"
```

---

### Task 10: Studio evidence picker — reorder, segmented control, German default, disabled reason

**Files:**
- Modify: `src/components/content-studio/evidence-source-picker.tsx`
- Modify: `src/components/content-studio/evidence-source-picker.test.tsx`
- Modify: `src/components/content-studio/content-studio-shell.tsx`
- Modify: `src/components/content-studio/content-studio-shell.test.tsx`
- Create: `src/lib/is-german-market.ts`
- Create: `src/lib/is-german-market.test.ts`

**Interfaces:**
- Produces: `isGermanMarket(market: string): boolean` — pure helper, consumed by `content-studio-shell.tsx`'s initial `language` state.
- `EvidenceSourcePicker`'s public props are unchanged (`{ websiteId?, onEvidenceLoaded }`) — only its internal mode-toggle markup changes from two independent `Button`s to the shared `Tabs`/`TabsList`/`TabsTrigger` segmented control already used for `entryMode` in the same file tree.

- [ ] **Step 1a: Write the failing test for `isGermanMarket`**

```typescript
// src/lib/is-german-market.test.ts
import { describe, expect, it } from 'vitest';
import { isGermanMarket } from './is-german-market';

describe('isGermanMarket', () => {
  it.each(['Germany', 'germany', 'DE', 'DACH', 'dach'])('matches %s', (market) => {
    expect(isGermanMarket(market)).toBe(true);
  });
  it.each(['United States', 'France', '', 'Germanyland'])('does not match %s', (market) => {
    expect(isGermanMarket(market)).toBe(false);
  });
});
```

- [ ] **Step 2a: Run test to verify it fails**

Run: `npx vitest run src/lib/is-german-market.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Write minimal implementation**

```typescript
// src/lib/is-german-market.ts
const GERMAN_MARKET_TERMS = new Set(['germany', 'de', 'dach']);

// Dashboard IA rebuild (2026-10-16 spec): "When a German market is set, default the language
// to German." Deliberately narrow (Germany/DE/DACH only, not Austria/Switzerland alone) --
// those two are themselves multi-language (Austria: German; Switzerland: German/French/
// Italian/Romansh), so matching on them alone would guess a language the spec didn't ask for.
export function isGermanMarket(market: string): boolean {
  return GERMAN_MARKET_TERMS.has(market.trim().toLowerCase());
}
```

- [ ] **Step 4a: Run test to verify it passes**

Run: `npx vitest run src/lib/is-german-market.test.ts`
Expected: PASS (2 parameterized groups)

- [ ] **Step 1b: Write the failing test for the segmented-control restyle**

Add to `evidence-source-picker.test.tsx` (read the existing file first to match its render/import conventions exactly before adding):

```tsx
  it('mode toggle uses the segmented-control (tab) pattern, not two independent accent buttons', () => {
    render(<EvidenceSourcePicker onEvidenceLoaded={vi.fn()} />);
    const urlTab = screen.getByRole('tab', { name: 'Paste a link' });
    const videoTab = screen.getByRole('tab', { name: 'Pick a video' });
    expect(urlTab).toHaveAttribute('aria-selected', 'true');
    expect(videoTab).toHaveAttribute('aria-selected', 'false');
  });
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npx vitest run src/components/content-studio/evidence-source-picker.test.tsx`
Expected: FAIL — no element with role `tab` (current markup uses two plain `<Button>`s).

- [ ] **Step 3b: Write minimal implementation**

Replace the mode-toggle `<div className="flex gap-2">...</div>` block in `evidence-source-picker.tsx` with the shared `Tabs` primitive already imported elsewhere in this component tree:

```tsx
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
// ...
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="url">Paste a link</TabsTrigger>
          <TabsTrigger value="video">Pick a video</TabsTrigger>
        </TabsList>
      </Tabs>
```

(Everything below — the `mode === 'url'`/`mode === 'video'` branches, the already-visible outline "Load evidence" button — is unchanged; the spec's "Make 'Load evidence' a visible secondary button" is already satisfied by the existing `variant="outline"` button at the current line 98–106, confirmed by reading the file — no change needed there.)

- [ ] **Step 4b: Run test to verify it passes**

Run: `npx vitest run src/components/content-studio/evidence-source-picker.test.tsx`
Expected: PASS — all prior + 1 new test.

- [ ] **Step 1c: Write the failing tests for reorder + German default + disabled reason**

Add to `content-studio-shell.test.tsx` (read its existing render-helper/fixture conventions first):

```tsx
  it('renders the evidence picker above the Topic field', () => {
    render(<ContentStudioShell {...baseProps} />);
    const topicLabel = screen.getByText('Topic');
    const pasteLinkTab = screen.getByRole('tab', { name: 'Paste a link' });
    expect(pasteLinkTab.compareDocumentPosition(topicLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('defaults the language to German when the client profile market is German', () => {
    render(<ContentStudioShell {...baseProps} clientProfileDefaults={{ audience: null, markets: ['Germany'], languages: ['German', 'English'] }} />);
    expect(screen.getByLabelText('Language')).toHaveValue('German');
  });

  it('shows why Generate is disabled when there is no topic', () => {
    render(<ContentStudioShell {...baseProps} />);
    expect(screen.getByText('Add a topic or pick a source')).toBeInTheDocument();
  });
```

(`baseProps` stands for whatever minimal-required-props fixture the existing test file already defines/uses for other tests in this suite — reuse it, do not invent a second one.)

- [ ] **Step 2c: Run test to verify it fails**

Run: `npx vitest run src/components/content-studio/content-studio-shell.test.tsx`
Expected: FAIL — picker still renders after Topic; language defaults to `clientProfileDefaults.languages[0]` regardless of market; no disabled-reason text exists.

- [ ] **Step 3c: Write minimal implementation**

In `content-studio-shell.tsx`:

1. Import `isGermanMarket` from `@/lib/is-german-market`.
2. Change the `language` state initializer:

```tsx
  const [language, setLanguage] = useState(
    isGermanMarket(clientProfileDefaults.markets[0] ?? '') && clientProfileDefaults.languages.includes('German')
      ? 'German'
      : clientProfileDefaults.languages[0] ?? ''
  );
```

3. Move the `<EvidenceSourcePicker websiteId={websiteId} onEvidenceLoaded={setAttachedEvidence} />` block (and its following `attachedEvidence` preview block) from its current position (after the Platform `<label>`) to immediately after the website-switcher/add-website-first block, before the `entryMode === 'opportunity'` crawl-finding `<label>`.
4. Add a disabled-reason line next to the Generate button:

```tsx
              <Button type="submit" variant="accent" disabled={loading || !topic.trim() || !websiteConfirmed} className="h-11">
                {loading ? <><ThinkingOrb state="composing" size={20} theme="dark" aria-hidden="true" className="mr-2" />Drafting…</> : 'Generate reviewed draft'}
              </Button>
              {!topic.trim() && websiteConfirmed && <p className="text-xs text-muted-foreground">Add a topic or pick a source</p>}
```

- [ ] **Step 4c: Run test to verify it passes**

Run: `npx vitest run src/components/content-studio/content-studio-shell.test.tsx`
Expected: PASS — all prior + 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/is-german-market.ts src/lib/is-german-market.test.ts src/components/content-studio/evidence-source-picker.tsx src/components/content-studio/evidence-source-picker.test.tsx src/components/content-studio/content-studio-shell.tsx src/components/content-studio/content-studio-shell.test.tsx
git commit -m "fix(dashboard-ia): Studio evidence picker reorder, segmented control, German default, disabled reason"
```

---

### Task 11: Wire it all into `page.tsx`

**Files:**
- Modify: `src/app/dashboard/[websiteId]/page.tsx`

**Interfaces:**
- Consumes everything built in Tasks 1–10.
- No new test file — this repo has zero page-level test files by established convention (confirmed in the brand-voice task); correctness here is enforced by (a) every unit test above on the pieces being wired, (b) a manual read-through of every changed consumer, (c) `tsc`/`next build` in the exit gate, (d) Task 1's `OVERVIEW_BLOCKS` test, which is meaningful specifically because this task makes the page actually map over it.

- [ ] **Step 1: Add the new queries**

Add alongside the existing `Promise.all` block (inside the `urlConfirmed` branch, same array destructure):

```typescript
    db.contentRecommendation.findMany({
      where: { websiteId: website.id, status: 'new' },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, topic: true, whyNow: true, createdAt: true },
    }),
```

(Add `contentRecommendationRows` to the destructured result list and to the `: []` fallback array.)

For the competitor-change count (Today card), reuse Task 2's shared builder with one small query, placed right after `clientProfile` is fetched:

```typescript
  const competitorEntities = urlConfirmed
    ? await db.competitorEntity.findMany({ where: { clientProfileId: website.clientProfileId }, select: { id: true, name: true } })
    : [];
  const competitorNameById = new Map(competitorEntities.map((c) => [c.id, c.name]));
  const competitorEvidence = competitorEntities.length
    ? await db.evidenceItem.findMany({
        where: { entityId: { in: competitorEntities.map((c) => c.id) }, platform: 'competitor_site' },
        orderBy: { retrievedAt: 'desc' },
        take: 20,
        select: { id: true, entityId: true, canonicalUrl: true, excerpt: true, retrievedAt: true, observedMetrics: true },
      })
    : [];
  const competitorChangeCount = buildCompetitorWatchItems(competitorEvidence, competitorNameById).length;
```

Import `buildCompetitorWatchItems` from `@/lib/competitor-watch`, `OVERVIEW_BLOCKS` from `@/lib/overview-layout`, `TodayCard` from `@/components/dashboard/today-card`, `PostIdeasCard` + `PostIdea` from `@/components/dashboard/post-ideas-card`.

- [ ] **Step 2: Build the Overview block map**

Replace the Overview `<>...</>` JSX (everything currently inside `overview={ <> ... </> }`) with a mapping over `OVERVIEW_BLOCKS`:

```tsx
          overview={
            <>
              {OVERVIEW_BLOCKS.map((id) => (
                <div key={id} className="mt-4 first:mt-0">
                  {id === 'today' && (
                    <TodayCard
                      websiteId={website.id}
                      pendingReviewCount={stats.pendingCount}
                      competitorChangeCount={competitorChangeCount}
                      postIdeaCount={contentRecommendationRows.length}
                      summary={
                        <Suspense fallback={<div className="h-5 animate-pulse rounded bg-muted" />}>
                          <AiInsightSection
                            customerId={customer.id}
                            input={{
                              pagesScanned: latestSummary?.pagesScanned ?? 0,
                              pagesFlagged: seoFindings.length,
                              guardCatchesDelta: guardCatchesDelta,
                              pendingCount: stats.pendingCount,
                            }}
                          />
                        </Suspense>
                      }
                    />
                  )}
                  {id === 'fixes-for-your-site' && (
                    <div>
                      <h2 className="mb-2 text-lg font-semibold text-foreground">Fixes for your site</h2>
                      <OpportunityBoard groups={opportunityGroups} websiteId={website.id} />
                    </div>
                  )}
                  {id === 'competitors-and-ideas' && (
                    <div id="competitors-and-ideas" className="grid grid-cols-1 gap-4 scroll-mt-6 lg:grid-cols-2">
                      <CompetitorWatchCard clientProfileId={website.clientProfileId} websiteId={website.id} />
                      <PostIdeasCard
                        websiteId={website.id}
                        ideas={contentRecommendationRows.map((r): PostIdea => ({ id: r.id, topic: r.topic, whyNow: r.whyNow, sourceDate: r.createdAt.toISOString() }))}
                      />
                    </div>
                  )}
                  {id === 'ask-dex' && <CommandBar websiteId={website.id} />}
                </div>
              ))}
            </>
          }
```

- [ ] **Step 3: Mount `LiveScanPanel` header-adjacent, remove `WebsiteEntryPanel` from inline Overview**

Move the `<LiveScanPanel>` block from its current mid-page position (just below the old `CommandBar`) to immediately after `<UtilityBar>` (before the `!urlConfirmed` branch), and delete the existing inline `<WebsiteEntryPanel>` block (lines ~336–340) entirely — it is now reached only via the site switcher (Task 9):

```tsx
      {urlConfirmed && (
        <UtilityBar
          websiteUrl={website.url}
          gscConnected={gscConnected}
          lastRefresh={latestScanJob?.completedAt ?? null}
          websites={websites}
          currentWebsiteId={website.id}
          profileName={clientProfile?.name}
          showAddWebsite
        />
      )}

      {urlConfirmed && latestScanJob && (
        <div className="mt-3">
          <LiveScanPanel
            key={website.id}
            websiteId={website.id}
            initialJobs={recentJobs}
            opportunitiesFoundCount={seoFindings.length}
            draftsReadyCount={pendingActions.filter((a) => a.generationStatus === 'succeeded').length}
            initialGamePreference={customer.gamePreference}
          />
        </div>
      )}
```

(The `!urlConfirmed` "Go to Settings" card, the GSC property-pending cards, and the `!latestScanJob` "no scans yet" branch — which still renders `DailyMissionCard` + `RealWorkFeed` directly, untouched, since it is outside `DashboardTabs` — are unchanged.)

- [ ] **Step 4: Move diagnostics to Analytics, unchanged**

In the `analytics={ <div className="flex flex-col gap-6"> ... </div> }` block, insert — verbatim, same JSX/classes as they had on Overview, moved not rewritten — immediately after the existing `DateRangeSelect` header row and before the current `StatCard` grid:

- The `RealWorkFeed` block (was Overview's `<div className="mt-4"><RealWorkFeed websiteId={website.id} /></div>`).
- The `hasFindingsData` conditional block containing the Opportunity Map / Site graph / Next mission / Agent evidence grids and the "No findings yet" fallback card — **minus `OpportunityBoard` itself**, which stays only in Overview's "Fixes for your site" block (do not duplicate it; Analytics keeps the Opportunity Map card from that first grid row, now on its own, plus the unchanged Site graph / Next mission / Agent evidence row below it).
- The `AgentEvidenceLedger` card.
- The `SiteBrief` block.
- `<ScanActivity jobs={recentJobs.map((j) => ({ id: j.id, status: j.status, createdAt: j.createdAt, completedAt: j.completedAt, error: j.error, resultSummary: j.resultSummary }))} />` with no `headerAction` and no `statusMessage` — the "Scan now" action and polling-error text now live in the header status line (Task 8), not duplicated here. `recentJobs` is already server-fetched earlier in this function (same data `LiveScanPanel` seeds its own state from) and `ScanActivity` is imported directly into `page.tsx`.

Each moved block keeps its exact existing `className` values from the current Overview JSX — this task is a cut-and-paste relocation, not a restyle, per spec rule 5.

- [ ] **Step 5: Run the full exit gate**

```bash
npx tsc --noEmit
npx vitest run
npx next build
```

`tsc` and `vitest` must be fully clean. `next build`'s 9 pre-existing Clerk-sandbox prerender failures (`/`, `/dashboard`, `/studio`, `/review`, `/settings`, `/dashboard-preview`, `/404`, `/500`, `/_not-found`) are the same standing baseline from `aafccec`/`da115f9`/`6c26c2a` — confirm the failing page list is unchanged (no new page added to it) rather than treating any build exit code as pass/fail on its own.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/\[websiteId\]/page.tsx
git commit -m "feat(dashboard-ia): wire Overview/Analytics restructure into page.tsx"
```

---

### Task 12: Design receipts and screenshots

Not a code task — a reporting step before replying "ready to ship":

- [ ] Run the six design skills against the changed surfaces (Overview, Analytics, Studio): `emil-design-eng` (always required), `ui-ux-pro-max`, `apple-design`, `impeccable`, plus `ui-styling` and `soft-skill` per the Tier 2 rule, and record a one-line receipt per skill in the done message.
- [ ] Attempt screenshots at 320px, 768px, 1280px for Overview, Analytics, and Studio. This sandbox has a standing Clerk-login gap (no test credentials, confirmed blocking all browser/screenshot verification all session) — if still blocked, state that explicitly in the done message rather than omitting screenshots silently.
- [ ] Re-state the known gap (no full Post-ideas board in Studio) in the done message, same as in this plan's header.

---

## Self-review (writing-plans skill, Step "Self-Review")

**Spec coverage:**
- Rule 1 (≤5 blocks, "What should I do today?") → Task 1 (`OVERVIEW_BLOCKS`), Task 11 (page wiring).
- Rule 2 (one verb button per block) → Task 6 (`TodayCard` mission button), existing `OpportunityBoard`/`CompetitorWatchCard`/`PostIdeasCard`/`CommandBar` each already single-action or newly given one.
- Rule 3 (each count once) → Task 6's three counts sourced from three disjoint server queries (`stats.pendingCount`, `competitorChangeCount`, `contentRecommendationRows.length`), each also the one place its respective card shows it; no other Overview block repeats a number.
- Rule 4 (diagnostics on Analytics) → Task 11 Step 4.
- Rule 5 (additive, keep classes) → Task 11 Step 4 explicit instruction; Task 8 keeps `LiveScanPanel`'s in-flight JSX byte-identical.
- Rule 6 (same order on mobile) → no breakpoint-conditional reordering introduced anywhere in this plan.
- Today block → Task 5 (hook extraction) + Task 6 (`TodayCard`).
- Fixes for your site → Task 11 Step 2 (`OpportunityBoard`, unchanged component).
- Competitors this week + Post ideas → Task 4 (empty state), Task 7 (`PostIdeasCard`), Task 11 Step 2.
- Ask Dex → Task 11 Step 2 (existing `CommandBar`, unchanged).
- Header scan status line → Task 8.
- `WebsiteEntryPanel` into site switcher → Task 9.
- Analytics moves → Task 11 Step 4.
- Competitors empty state copy/actions → Task 4.
- Studio evidence-picker reorder/segmented-control/visible Load-evidence/German-default → Task 10 (visible Load-evidence confirmed already satisfied, no change needed there).
- Generate disabled-reason → Task 10 Step 3c.
- Acceptance: block count/order test → Task 1. No-duplicate-count → Task 6 design note above (no dedicated contrived test; satisfied by construction, documented). Moved-card class assertions → Task 11 Step 4's explicit "keep exact classNames" instruction (verified at review time, not by a new automated class-snapshot test, since this repo has no existing snapshot-testing convention to extend). Empty/loading/filled states for Today/Competitors/Post ideas → Task 6, Task 4, Task 7 tests.
- Tier 2 design rule + screenshots → Task 12.

**Placeholder scan:** no "TBD"/"handle it"/"similar to Task N" found; every step has real code or an explicit cross-reference to a fully-specified snippet shown earlier in the same task.

**Type consistency:** `TodayCardProps`, `PostIdea`, `CompetitorWatchItem`, `OverviewBlockId` are each defined once and imported everywhere they're used; `buildCompetitorWatchItems`'s signature matches both its Task 2 route call site and its Task 11 page.tsx call site.
