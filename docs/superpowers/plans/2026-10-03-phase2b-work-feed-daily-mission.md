# Phase 2B: Real Work Feed + Daily Mission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polled feed of recent scan work and a daily mission that sends the user to the next real action in the Observe/Prioritize/Learn loop.

**Architecture:** Two authenticated dashboard APIs resolve the requested website through the existing tenant-ownership boundary before reading any data. The work-feed API returns the ten newest scan jobs and uses `startedAt ?? createdAt` as its display timestamp. The mission API counts queued/running scans and pending `Action` rows, an existing review state in the schema. Client components poll or fetch those APIs and render links that perform a real navigation.

**Tech Stack:** Next.js 14.2.4 App Router, React 18.3.1, Prisma, Clerk server auth, Tailwind CSS, TypeScript, Vitest, React Testing Library, native `Intl.DateTimeFormat`

## Global Constraints

- No database migration or schema change.
- Use existing `ScanJob`, `Finding`, and `Action` fields only.
- Preserve manual apply: a mission may navigate to review, scan controls, or the feed, but it never approves or executes an action.
- Every slice adds an automated behavior test; API route tests cover authentication, ownership, and scoped data access.
- Keep the existing Vitest Node default. Use jsdom only for `*.test.tsx` files and load jest-dom through a setup file.
- Commit once per completed task and include test evidence in the commit message.

## Verified Repository Contracts

Evidence was checked against the repository at `060ffcc24ba4643ee21ee034011e9984a241193f`:

| Contract | Repository evidence | Consequence |
|---|---|---|
| Auth and ownership | `auth()` is exported by `@clerk/nextjs/server`; `resolveWebsiteForRequest(userId, websiteId)` and `WebsiteNotFoundError` are exported by `src/lib/customer.ts` | Both new APIs return 401 without a user and 404 when the requested website is not owned. Queries use the resolved `website.id`, never the raw query value. |
| Prisma client | `src/lib/db.ts` exists and exports `db`; `@/*` maps to `src/*` | Import `db` from `@/lib/db`. |
| Scan fields | `ScanJob` has `id`, `websiteId`, `status: String`, `createdAt`, nullable `startedAt`, and `findings`; its documented statuses are `queued`, `running`, `completed`, `failed`, and `cancelled` | Return all five known statuses plus a safe `unknown` normalization. Derive the timestamp from `startedAt ?? createdAt`. |
| Finding fields | `Finding` has `id`, `ruleId`, and `severity`; it has no review/seen field | The feed may show findings. Daily Mission must not label all findings “unreviewed.” |
| Review state | `Action.status` is the `ActionStatus` enum: `pending`, `approved`, `edited`, `rejected`; `/review` is the existing review surface | Daily Mission uses website-scoped pending Action count and labels it “pending actions.” |
| Scan trigger surface | The dashboard already renders `LiveScanPanel`; Phase 2B can add an enclosing `id="scan-control"` | “New Scan” links to `#scan-control`. |
| Component test dependencies | `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` are absent; Vitest 1.6 uses Node by default | Task 0 installs only these development dependencies and uses `environmentMatchGlobs`. |
| Date formatting | `date-fns` is absent | Use native `Intl.DateTimeFormat`; add no date package. |

## Files

**New:**

- `src/test/setup.ts`
- `src/test/react-testing-library.test.tsx`
- `src/app/api/dashboard/work-feed/route.ts`
- `src/app/api/dashboard/work-feed/route.test.ts`
- `src/app/api/dashboard/daily-mission/route.ts`
- `src/app/api/dashboard/daily-mission/route.test.ts`
- `src/components/dashboard/work-feed.tsx`
- `src/components/dashboard/work-feed.test.tsx`
- `src/components/dashboard/daily-mission-card.tsx`
- `src/components/dashboard/daily-mission-card.test.tsx`
- `src/lib/daily-mission-logic.ts`
- `src/lib/daily-mission-logic.test.ts`

**Modified:**

- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `src/app/dashboard/[websiteId]/page.tsx`

## Task Breakdown (6 ordered slices)

### Task 0: Install and Configure the React Component-Test Harness

**Files:** manifests, `vitest.config.ts`, `src/test/setup.ts`, and the harness smoke test.

- [ ] Reconfirm the three packages are absent and preserve the existing `environment: 'node'` and `exclude` values.
- [ ] Run `npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom`; verify no production dependency changed.
- [ ] Add this to the existing Vitest `test` object:

```typescript
environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
setupFiles: ['./src/test/setup.ts'],
```

- [ ] Create `src/test/setup.ts` with `import '@testing-library/jest-dom/vitest';`.
- [ ] Add a smoke test that renders `<p>Harness ready</p>` and asserts `toBeInTheDocument()`.
- [ ] Run and commit:

```bash
npm run test -- src/test/react-testing-library.test.tsx
git add package.json package-lock.json vitest.config.ts src/test/setup.ts src/test/react-testing-library.test.tsx
git commit -m "test: configure React Testing Library harness"
```

### Task 1: Daily Mission Logic

**Files:** `src/lib/daily-mission-logic.ts` and its unit test.

Use accurate names and make every CTA actionable:

```typescript
export interface UserLoopState {
  activeScans: number;
  pendingActions: number;
}

export interface Mission {
  icon: string;
  title: string;
  description: string;
  cta: string;
  ctaHref: string;
}

export function computeNextMission(state: UserLoopState): Mission {
  if (state.activeScans > 0) {
    return {
      icon: '🔍', title: 'Audit in Progress',
      description: 'Follow the latest scan as it runs.',
      cta: 'Watch Feed', ctaHref: '#work-feed',
    };
  }
  if (state.pendingActions > 0) {
    return {
      icon: '📋',
      title: `Review ${state.pendingActions} Pending Action${state.pendingActions === 1 ? '' : 's'}`,
      description: 'Draft changes are waiting for your decision.',
      cta: 'Open Review Queue', ctaHref: '/review',
    };
  }
  return {
    icon: '🚀', title: 'Start a New Audit',
    description: 'Run an audit to find the next opportunity.',
    cta: 'New Scan', ctaHref: '#scan-control',
  };
}
```

- [ ] Test all three branches and assert both CTA text and exact `ctaHref` for each branch.
- [ ] Run `npm run test -- src/lib/daily-mission-logic.test.ts` and commit both files.

### Task 2: Authenticated Real Work Feed API

**Files:** `src/app/api/dashboard/work-feed/route.ts` and `route.test.ts`.

The test must construct a real `NextRequest`, mock every external boundary, and verify query scoping:

```typescript
import { NextRequest } from 'next/server';

function makeRequest(websiteId?: string) {
  const url = new URL('http://localhost:3000/api/dashboard/work-feed');
  if (websiteId) url.searchParams.set('websiteId', websiteId);
  return new NextRequest(url);
}
```

- [ ] Mock `auth`, `resolveWebsiteForRequest`, `WebsiteNotFoundError`, and `db.scanJob.findMany` before importing/using the handler, following existing route-test patterns.
- [ ] Add tests for: unauthenticated → 401 and no resolver/query call; missing `websiteId` → 400; foreign website → 404 and no query; owned website → 200, resolver called with `userId` and requested ID, and Prisma scoped to the resolved website ID.
- [ ] In the success fixture include a queued scan with `startedAt: null` and assert its serialized timestamp comes from `createdAt`. Include representative `completed`, `failed`, and `cancelled` statuses so the response contract cannot regress to `running | complete`.

Implement this order in the handler:

1. Call `auth()` and return 401 when `userId` is absent.
2. Read `websiteId` through `request.nextUrl.searchParams`; return 400 when absent.
3. Call `resolveWebsiteForRequest(userId, websiteId)`; translate `WebsiteNotFoundError` to 404.
4. Query with `where: { websiteId: website.id }`, `orderBy: { createdAt: 'desc' }`, `take: 10`, and include only finding `id`, `ruleId`, and `severity`.
5. Serialize `timestamp: (scan.startedAt ?? scan.createdAt).toISOString()` and normalize the schema's string status through:

```typescript
const SCAN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
type ScanStatus = (typeof SCAN_STATUSES)[number] | 'unknown';

function scanStatus(value: string): ScanStatus {
  return (SCAN_STATUSES as readonly string[]).includes(value)
    ? value as (typeof SCAN_STATUSES)[number]
    : 'unknown';
}
```

- [ ] Run and commit, including the test file in staging:

```bash
npm run test -- src/app/api/dashboard/work-feed/route.test.ts
git add src/app/api/dashboard/work-feed/route.ts src/app/api/dashboard/work-feed/route.test.ts
git commit -m "feat: add authenticated work-feed API with tests"
```

### Task 3: Real Work Feed Component ⭐ CODEX TRIAL

**Files:** `src/components/dashboard/work-feed.tsx` and its component test.

This is the designated Codex trial: it is isolated, fetch is mocked, and it contains no ownership or mission business logic.

- [ ] Model each item as `{ scanId, timestamp: string, status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown', findingCount, findings }`.
- [ ] Fetch `/api/dashboard/work-feed?websiteId=${encodeURIComponent(websiteId)}` immediately and every 30 seconds; clear the interval on unmount.
- [ ] Render the root with `id="work-feed"`. Format `new Date(item.timestamp)` with a module-level native `Intl.DateTimeFormat`.
- [ ] Render status text for every current status; never assume only running/completed.
- [ ] Tests cover loading, an empty response, a populated response with a nullable-start fallback timestamp already serialized by the API, and cleanup of the polling interval.
- [ ] Run and commit:

```bash
npm run test -- src/components/dashboard/work-feed.test.tsx
git add src/components/dashboard/work-feed.tsx src/components/dashboard/work-feed.test.tsx
git commit -m "feat: add RealWorkFeed component as Codex trial"
```

### Task 4: Authenticated Daily Mission API

**Files:** `src/app/api/dashboard/daily-mission/route.ts` and `route.test.ts`.

- [ ] Use the same `NextRequest`, Clerk, resolver, and Prisma mocking pattern as Task 2.
- [ ] Add tests for unauthenticated → 401; missing website ID → 400; foreign website → 404 with no counts; and owned website → 200 with the returned mission.
- [ ] In the success test assert both queries use `website.id` from the resolver:

```typescript
db.scanJob.count({
  where: { websiteId: website.id, status: { in: ['queued', 'running'] } },
});
db.action.count({ where: { websiteId: website.id, status: 'pending' } });
```

- [ ] Pass `{ activeScans, pendingActions }` to `computeNextMission`. Do not query `Finding` or use the word “unreviewed.”
- [ ] Run and commit:

```bash
npm run test -- src/app/api/dashboard/daily-mission/route.test.ts
git add src/app/api/dashboard/daily-mission/route.ts src/app/api/dashboard/daily-mission/route.test.ts
git commit -m "feat: add authenticated daily-mission API with tests"
```

### Task 5: Daily Mission Card and Dashboard Integration

**Files:** `src/components/dashboard/daily-mission-card.tsx`, its test, and `src/app/dashboard/[websiteId]/page.tsx`.

- [ ] Implement the client card with loading and fetch-error states. Fetch the mission for the encoded website ID.
- [ ] Because `Mission.ctaHref` is required, always render the CTA as `<Link href={mission.ctaHref}>`; do not render a fallback inert `<button>`.
- [ ] Component tests assert loading, the rendered mission, and that all three mission fixtures expose the exact actionable hrefs `#work-feed`, `/review`, and `#scan-control`.
- [ ] Integrate `<DailyMissionCard websiteId={website.id} />` and `<RealWorkFeed websiteId={website.id} />` into the existing dashboard without replacing its current content. Add `id="scan-control"` to the existing wrapper around `LiveScanPanel`, so the New Scan link has a real target.
- [ ] In the component test, assert the exact `href` for all three mission fixtures. For `#work-feed` and `#scan-control`, render the matching target fixture and assert `document.querySelector(href)` resolves only after confirming `href.startsWith('#')`. For `/review`, assert the exact route string and do not pass it to `document.querySelector`. The browser check below verifies the real page integration. Then run the focused component tests and TypeScript:

```bash
npm run test -- src/components/dashboard/daily-mission-card.test.tsx src/components/dashboard/work-feed.test.tsx
npx tsc --noEmit
```

- [ ] Manually verify `/dashboard/<owned-website-id>`: both surfaces render, every CTA navigates or scrolls, tenant-scoped API requests succeed, and no action is auto-applied.
- [ ] Commit all three files:

```bash
git add src/components/dashboard/daily-mission-card.tsx src/components/dashboard/daily-mission-card.test.tsx 'src/app/dashboard/[websiteId]/page.tsx'
git commit -m "feat: integrate tested daily mission and work feed"
```

## Execution Order

1. Test harness
2. Pure mission logic
3. Authenticated work-feed API
4. ⭐ RealWorkFeed Codex trial
5. Authenticated mission API
6. Tested mission card and dashboard integration

All six slices preserve native `Intl`, the existing `@/lib/db` client, manual apply, and the repository's tenant boundary. No product code, schema, or deployment is changed by this planning commit.
