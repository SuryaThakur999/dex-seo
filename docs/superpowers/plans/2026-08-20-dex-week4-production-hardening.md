# Dex Week 4: Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five real gaps surfaced by prior weeks' final-review findings before Dex is deployed to production: no lint tooling, a real cost leak on re-flagged approved pages, a blind spot in what Growth Brain can see, zero test coverage on the Review UI's authorization logic, and a synchronous `/api/scan` that realistically exceeds Vercel's function timeout.

**Architecture:** The scan pipeline's business logic (currently inline in `/api/scan/route.ts`) gets extracted into a reusable `runScanForCustomer()` function, then `/api/scan` becomes a thin enqueue-only endpoint backed by a new `ScanJob` Postgres table, processed by a Vercel Cron job hitting a new worker route once a minute. Everything else (lint, cooldown, sitemap supplement, auth tests) lands first as smaller, lower-risk changes to the existing synchronous route before that extraction happens, so the extraction task has a single, already-correct piece of logic to move rather than a moving target.

**Tech Stack:** Adds ESLint + `eslint-config-next` to the existing Next.js 14 / Prisma / Clerk / Tailwind stack. No new runtime dependencies for the other items (job queue is hand-rolled on existing Postgres, sitemap parsing is a small regex, not a new XML library).

**Explicitly out of scope for this plan:** the Clerk major-version upgrade originally planned for this week. Clerk's current docs show `createRouteMatcher()` (used in `src/middleware.ts`) is now flagged deprecated in favor of "resource-based auth checks," and the exact current `auth()` sync/async contract and middleware pattern couldn't be confirmed from what's fetchable right now. Guessing the exact API and shipping it here would risk breaking every authenticated route. This needs its own dedicated research pass before a plan can be written for it — tracked separately, not silently dropped.

## Global Constraints

- No behavior change to GrowthGuard's checklist, Growth Brain's flagging criteria, or the Creation Engine's prompt — this plan touches orchestration/infrastructure around the pipeline, not the pipeline's decision logic itself.
- The cooldown window and sitemap supplement must not weaken any existing safety property — they only affect which pages get scanned/flagged, never whether GrowthGuard's outcome can be bypassed.
- `runScanForCustomer()` must produce byte-identical behavior to the current inline `/api/scan` logic (same cooldown, same sitemap merge, same dedup, same error handling per page) — this is a refactor (extract function), not a rewrite. Verify by diffing the moved logic line-for-line against what Tasks 2-3 land in the existing route.
- The new `/api/scan/process` worker route must NOT be reachable by a customer's own Clerk session — it processes the oldest queued job for ANY customer, not scoped to a request's authenticated user, and each run costs real OpenAI money. It is protected by a `CRON_SECRET` bearer-token check instead, and must be excluded from `middleware.ts`'s Clerk-protected route matcher.
- Every new test file follows the existing mocking pattern already established in `src/lib/customer.test.ts` and `src/lib/audit-log.test.ts` (`vi.mock('@/lib/db', ...)` with only the methods actually used stubbed) — don't invent a different testing approach.
- Secrets: this plan introduces exactly one new env var, `CRON_SECRET` — add it to `.env.example` (blank), never commit a real value.

---

## File Structure

```
.eslintrc.json                                  (NEW)
package.json                                    (MODIFY — add eslint deps + lint script)
.env.example                                     (MODIFY — add CRON_SECRET)
vercel.json                                      (NEW — cron config)
prisma/schema.prisma                             (MODIFY — add ScanJob model)
src/
  lib/
    gsc-client.ts                                (MODIFY — add fetchSitemapUrls, mergeSitemapUrls)
    gsc-client.test.ts                            (MODIFY — test the two new functions)
    run-scan.ts                                   (NEW — extracted scan pipeline, Task 5)
  app/
    api/
      scan/
        route.ts                                 (MODIFY — Task 2/3 in place, Task 6 becomes enqueue-only)
        process/route.ts                          (NEW — Task 5, cron worker)
      actions/[actionId]/
        approve/route.test.ts                     (NEW)
        reject/route.test.ts                      (NEW)
        edit/route.test.ts                        (NEW)
      settings/auto-execute/route.test.ts          (NEW)
    dashboard/page.tsx                            (MODIFY — show latest ScanJob status)
  middleware.ts                                   (MODIFY — narrow /api/scan matcher, Task 6)
```

One responsibility per file: `run-scan.ts` is the only place the crawl→flag→dedup→draft→guard→persist pipeline lives — both `/api/scan` (enqueue) and `/api/scan/process` (worker) call it, neither duplicates it. `gsc-client.ts` gains two more small, focused exports alongside its existing ones, no new file needed there.

---

### Task 1: ESLint Setup

**Files:**
- Create: `.eslintrc.json`
- Modify: `package.json`
- Modify: whatever files `npm run lint` flags (see Step 3)

**Interfaces:**
- Produces: a working `npm run lint` command other tasks (and future work) can run.

- [ ] **Step 1: Add ESLint dependencies to `package.json`**

Add to `devDependencies`:
```json
    "eslint": "^8.57.0",
    "eslint-config-next": "^14.2.4",
```

Run: `npm install`

- [ ] **Step 2: Write `.eslintrc.json`**

```json
{
  "extends": "next/core-web-vitals"
}
```

- [ ] **Step 3: Add the lint script to `package.json`**

Add to `scripts`:
```json
    "lint": "next lint",
```

- [ ] **Step 4: Run the linter and fix every violation it reports**

Run: `npm run lint`

For each error or warning reported, fix it directly in the file/line it names — most likely candidates given this codebase's history: unused imports or variables (e.g. any leftover from a prior task's refactor), missing `key` props on list items, or `react-hooks` rule violations in the client components (`auto-execute-toggle.tsx`, `copy-button.tsx`). Do not suppress a finding with an `eslint-disable` comment unless the rule is genuinely inapplicable to that specific line — if you do, the comment must state why in one line. Do not refactor anything the linter didn't flag.

Run: `npm run lint` again after each fix batch until it exits clean.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx vitest run` — expect all existing tests still passing.
Run: `npm run build` — expect a clean build.

- [ ] **Step 6: Commit**

```bash
git add .eslintrc.json package.json package-lock.json
# also add any files touched by Step 4's fixes — list them explicitly based on what npm run lint actually flagged
git commit -m "chore: add ESLint (next/core-web-vitals), fix violations it surfaced"
```

---

### Task 2: Cooldown Window for the Re-Draft Cost Leak

**Files:**
- Modify: `src/app/api/scan/route.ts`

**Interfaces:**
- Consumes: nothing new — this is a self-contained addition to the existing per-page loop.
- Produces: the cooldown behavior Task 5 will carry into `run-scan.ts` verbatim.

- [ ] **Step 1: Add the cooldown constant and check**

In `src/app/api/scan/route.ts`, add this constant alongside the existing three (`MAX_PAGES_PER_SCAN`, `MAX_DRAFTS_PER_SCAN`, `RECENT_DRAFTS_LIMIT`):

```ts
const COOLDOWN_DAYS = 14;
```

Then, inside the `for (const page of flagged)` loop, immediately after the existing `alreadyPending` check block:

```ts
      const alreadyPending = await db.action.findFirst({
        where: { customerId: customer.id, pageUrl: page.url, status: 'pending' },
      });
      if (alreadyPending) continue;
```

add:

```ts
      const recentlyDecided = await db.action.findFirst({
        where: {
          customerId: customer.id,
          pageUrl: page.url,
          status: { in: ['approved', 'edited'] },
          decidedAt: { gte: new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000) },
        },
      });
      if (recentlyDecided) continue; // approved/edited within the cooldown window — don't burn another OpenAI call re-drafting an unchanged page
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run build` — expect a clean build.
Run: `npm run lint` — expect clean (Task 1 already established the baseline).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/scan/route.ts
git commit -m "feat: add 14-day cooldown to stop re-drafting recently approved/edited pages"
```

---

### Task 3: GSC Blind-Spot Mitigation — Sitemap Supplement

**Files:**
- Modify: `src/lib/gsc-client.ts`
- Modify: `src/lib/gsc-client.test.ts`
- Modify: `src/app/api/scan/route.ts`

**Interfaces:**
- Produces: `fetchSitemapUrls(websiteUrl: string, fetchImpl?: typeof fetch): Promise<string[]>` and `mergeSitemapUrls(performance: PagePerformance[], sitemapUrls: string[]): PagePerformance[]` from `src/lib/gsc-client.ts` — `mergeSitemapUrls` is used by both this task's `route.ts` wiring and Task 5's `run-scan.ts` extraction.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/gsc-client.test.ts` (keep every existing test in the file exactly as-is — this is additive):

```ts
import { describe, it, expect, vi } from 'vitest';
import { extractPageUrls, extractPagePerformance, fetchSitemapUrls, mergeSitemapUrls } from './gsc-client';

describe('fetchSitemapUrls', () => {
  it('extracts <loc> URLs from a sitemap.xml response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>',
    });

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('returns an empty array when the sitemap fetch fails or is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual([]);
  });

  it('returns an empty array without throwing when the fetch itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));

    const urls = await fetchSitemapUrls('https://example.com', fetchImpl as unknown as typeof fetch);

    expect(urls).toEqual([]);
  });
});

describe('mergeSitemapUrls', () => {
  it('adds sitemap URLs not already present as zero-metric entries', () => {
    const performance = [{ url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 }];
    const sitemapUrls = ['https://example.com/a', 'https://example.com/c'];

    const merged = mergeSitemapUrls(performance, sitemapUrls);

    expect(merged).toEqual([
      { url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 },
      { url: 'https://example.com/c', impressions: 0, clicks: 0, ctr: 0 },
    ]);
  });

  it('returns the original performance list unchanged when every sitemap URL already has GSC data', () => {
    const performance = [{ url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 }];

    const merged = mergeSitemapUrls(performance, ['https://example.com/a']);

    expect(merged).toEqual(performance);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/gsc-client.test.ts`
Expected: FAIL — `fetchSitemapUrls`/`mergeSitemapUrls` are not exported yet.

- [ ] **Step 3: Add the two functions to `src/lib/gsc-client.ts`**

Append to the end of the file:

```ts
export async function fetchSitemapUrls(websiteUrl: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const sitemapUrl = new URL('/sitemap.xml', websiteUrl).toString();
    const res = await fetchImpl(sitemapUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const matches = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)];
    return matches.map((m) => m[1]).filter((url): url is string => Boolean(url));
  } catch {
    return [];
  }
}

export function mergeSitemapUrls(performance: PagePerformance[], sitemapUrls: string[]): PagePerformance[] {
  const existingUrls = new Set(performance.map((page) => page.url));
  const supplemental = sitemapUrls
    .filter((url) => !existingUrls.has(url))
    .map((url) => ({ url, impressions: 0, clicks: 0, ctr: 0 }));
  return [...performance, ...supplemental];
}
```

This is a deliberately simple regex-based extraction, not a full XML parser — sitemap-index files (a sitemap that only links to other sitemaps) and gzip-compressed sitemaps are not handled; a customer whose site uses either gets no supplemental URLs from this function, silently (matches the function's existing fail-open behavior on any other fetch/parse problem). This is a reasonable Phase 1 tradeoff, not a bug — noting it here so it isn't rediscovered as a surprise.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/gsc-client.test.ts`
Expected: PASS (8 tests — the 4 existing plus 5 new)

- [ ] **Step 5: Wire the merge into `src/app/api/scan/route.ts`**

Change the import line:
```ts
import { listPagePerformance } from '@/lib/gsc-client';
```
to:
```ts
import { listPagePerformance, fetchSitemapUrls, mergeSitemapUrls } from '@/lib/gsc-client';
```

Change:
```ts
    const refreshToken = decrypt(customer.gscRefreshToken);
    const performance = (await listPagePerformance(refreshToken, customer.websiteUrl)).slice(0, MAX_PAGES_PER_SCAN);
```
to:
```ts
    const refreshToken = decrypt(customer.gscRefreshToken);
    const gscPerformance = await listPagePerformance(refreshToken, customer.websiteUrl);
    const sitemapUrls = await fetchSitemapUrls(customer.websiteUrl);
    const performance = mergeSitemapUrls(gscPerformance, sitemapUrls).slice(0, MAX_PAGES_PER_SCAN);
```

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run build` — expect a clean build.
Run: `npm run lint` — expect clean.
Run: `npx vitest run` — expect all tests passing (this task added 5, no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/lib/gsc-client.ts src/lib/gsc-client.test.ts src/app/api/scan/route.ts
git commit -m "feat: supplement GSC performance data with sitemap.xml URLs so zero-impression pages aren't invisible to scans"
```

---

### Task 4: Route-Level Authorization Tests

**Files:**
- Create: `src/app/api/actions/[actionId]/approve/route.test.ts`
- Create: `src/app/api/actions/[actionId]/reject/route.test.ts`
- Create: `src/app/api/actions/[actionId]/edit/route.test.ts`
- Create: `src/app/api/settings/auto-execute/route.test.ts`

**Interfaces:**
- Consumes: the four route handlers exactly as they exist today (Week 3, unmodified by this task).
- Produces: a durable regression net for the cross-tenant ownership check and the block-outcome gate — the two safety properties Week 3's final review verified only by manual trace.

- [ ] **Step 1: Write `src/app/api/actions/[actionId]/approve/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { findUnique: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/actions/action_1/approve', { method: 'POST' }) as unknown as NextRequest;
}

const CUSTOMER = { id: 'cust_1', clerkUserId: 'user_1' };

describe('POST /api/actions/[actionId]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the action belongs to a different customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'someone_elses_customer_id',
      status: 'pending',
      guardResult: { outcome: 'pass' },
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the action is not pending', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'approved',
      guardResult: { outcome: 'pass' },
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 and does not approve when GrowthGuard outcome is block', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      guardResult: { outcome: 'block' },
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('approves a pending, non-blocked action owned by the authenticated customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      guardResult: { outcome: 'pass' },
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Write `src/app/api/actions/[actionId]/reject/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { findUnique: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/actions/action_1/reject', { method: 'POST' }) as unknown as NextRequest;
}

const CUSTOMER = { id: 'cust_1', clerkUserId: 'user_1' };

describe('POST /api/actions/[actionId]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the action belongs to a different customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'someone_elses_customer_id',
      status: 'pending',
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the action is not pending', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'rejected',
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a pending action regardless of its GrowthGuard outcome', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Write `src/app/api/actions/[actionId]/edit/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { findUnique: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

function makeRequest(draftContent?: string): NextRequest {
  const form = new FormData();
  if (draftContent !== undefined) form.set('draftContent', draftContent);
  return new Request('http://localhost:3000/api/actions/action_1/edit', {
    method: 'POST',
    body: form,
  }) as unknown as NextRequest;
}

const CUSTOMER = { id: 'cust_1', clerkUserId: 'user_1' };

describe('POST /api/actions/[actionId]/edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest('New text'), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the action belongs to a different customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'someone_elses_customer_id',
      status: 'pending',
    });

    const res = await POST(makeRequest('New text'), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the action is not pending', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'edited',
    });

    const res = await POST(makeRequest('New text'), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 when the submitted draftContent is empty', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
    });

    const res = await POST(makeRequest('   '), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('saves the edited draft and marks the action edited', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
    });

    const res = await POST(makeRequest('My edited description.'), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.action.update).toHaveBeenCalledWith({
      where: { id: 'action_1' },
      data: { draftContent: 'My edited description.', status: 'edited', decidedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 4: Write `src/app/api/settings/auto-execute/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

function makeRequest(enabled: boolean): NextRequest {
  return new Request('http://localhost:3000/api/settings/auto-execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }) as unknown as NextRequest;
}

describe('POST /api/settings/auto-execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest(true));

    expect(res.status).toBe(401);
  });

  it('returns 404 when no customer row exists for this user', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest(true));

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('toggles autoExecuteEnabled and records an audit event', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust_1', clerkUserId: 'user_1' });

    const res = await POST(makeRequest(true));

    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 'cust_1' }, data: { autoExecuteEnabled: true } });
  });
});
```

- [ ] **Step 5: Run all four test files, plus the full suite**

Run: `npx vitest run src/app/api/actions src/app/api/settings`
Expected: PASS (18 new tests across the 4 files)

Run: `npx vitest run` (full suite)
Expected: all tests passing, no regressions.

- [ ] **Step 6: Type-check, build, lint**

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run build` — expect a clean build.
Run: `npm run lint` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/actions/\[actionId\]/approve/route.test.ts src/app/api/actions/\[actionId\]/reject/route.test.ts src/app/api/actions/\[actionId\]/edit/route.test.ts src/app/api/settings/auto-execute/route.test.ts
git commit -m "test: add authorization tests for the four Review UI routes (cross-tenant check, block-outcome gate, status guards)"
```

---

### Task 5: ScanJob Model, Pipeline Extraction, and Cron Worker Route

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/run-scan.ts`
- Create: `src/app/api/scan/process/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `interface ScanResult { pagesScanned: number; pagesFlagged: number; draftsCreated: number; errors: { url: string; error: string }[] }` and `runScanForCustomer(customer: Customer): Promise<ScanResult>` from `src/lib/run-scan.ts` — used by Task 6's rewritten `/api/scan/route.ts` is NOT required (that route only enqueues), but IS used directly by this task's own `process/route.ts`, and will be the only caller going forward.
- This task does NOT modify the existing `/api/scan/route.ts` — that file keeps working standalone, synchronously, exactly as Tasks 2-3 left it, until Task 6 cuts it over. The logic below is a copy, not a move, until Task 6 deletes the original.

- [ ] **Step 1: Add `ScanJob` to `prisma/schema.prisma`**

Add this model at the end of the file:

```prisma
model ScanJob {
  id            String    @id @default(cuid())
  customerId    String
  customer      Customer  @relation(fields: [customerId], references: [id])
  status        String    @default("queued") // queued | running | completed | failed
  createdAt     DateTime  @default(now())
  startedAt     DateTime?
  completedAt   DateTime?
  resultSummary Json?
  error         String?
}
```

Add the back-relation to `Customer` — insert alongside the existing `actions Action[]` and `auditLogEntries AuditLogEntry[]` lines:

```prisma
  scanJobs        ScanJob[]
```

- [ ] **Step 2: Generate and apply the migration**

Ensure `DATABASE_URL` is set in `.env.local` to the same real Neon Postgres connection string used in prior weeks.

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

Run: `npx prisma migrate dev --name add_scan_job`
Expected: migration created and applied, `ScanJob` table exists.

- [ ] **Step 3: Add `CRON_SECRET` to `.env.example`**

Add this line (alongside the existing entries):
```
CRON_SECRET=
```

- [ ] **Step 4: Write `src/lib/run-scan.ts`**

This is the exact body of `/api/scan/route.ts`'s `try` block as it exists after Tasks 2-3 (cooldown + sitemap merge already in place), extracted into a standalone async function parameterized on an already-fetched `Customer` instead of doing its own auth/session lookup:

```ts
import type { Customer, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { listPagePerformance, fetchSitemapUrls, mergeSitemapUrls } from '@/lib/gsc-client';
import { fetchPageMeta } from '@/lib/crawler';
import { flagPages, type PageSnapshot } from '@/lib/growth-brain';
import { draftMetaDescription } from '@/lib/creation-engine';
import { runGrowthGuard, decideActionStatus } from '@/lib/growth-guard';

const MAX_PAGES_PER_SCAN = 20;
const MAX_DRAFTS_PER_SCAN = 10;
const RECENT_DRAFTS_LIMIT = 50;
const COOLDOWN_DAYS = 14;

export interface ScanResult {
  pagesScanned: number;
  pagesFlagged: number;
  draftsCreated: number;
  errors: { url: string; error: string }[];
}

export async function runScanForCustomer(customer: Customer): Promise<ScanResult> {
  if (!customer.gscRefreshToken) {
    throw new Error('Customer has not connected Google Search Console');
  }

  const refreshToken = decrypt(customer.gscRefreshToken);
  const gscPerformance = await listPagePerformance(refreshToken, customer.websiteUrl);
  const sitemapUrls = await fetchSitemapUrls(customer.websiteUrl);
  const performance = mergeSitemapUrls(gscPerformance, sitemapUrls).slice(0, MAX_PAGES_PER_SCAN);

  const snapshots: PageSnapshot[] = [];
  for (const page of performance) {
    const meta = await fetchPageMeta(page.url);
    if (!meta.title && !meta.h1 && !meta.metaDescription) {
      continue;
    }
    snapshots.push({ ...page, ...meta });
  }

  const flagged = flagPages(snapshots).slice(0, MAX_DRAFTS_PER_SCAN);

  let draftsCreated = 0;
  const errors: { url: string; error: string }[] = [];

  for (const page of flagged) {
    const alreadyPending = await db.action.findFirst({
      where: { customerId: customer.id, pageUrl: page.url, status: 'pending' },
    });
    if (alreadyPending) continue;

    const recentlyDecided = await db.action.findFirst({
      where: {
        customerId: customer.id,
        pageUrl: page.url,
        status: { in: ['approved', 'edited'] },
        decidedAt: { gte: new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000) },
      },
    });
    if (recentlyDecided) continue;

    try {
      const recentActions = await db.action.findMany({
        where: { customerId: customer.id, actionType: 'meta_description', pageUrl: { not: page.url } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_DRAFTS_LIMIT,
        select: { draftContent: true },
      });
      const recentDraftsForCustomer = recentActions.map((a) => a.draftContent);

      const { draftContent, tokenCost } = await draftMetaDescription({
        url: page.url,
        title: page.title,
        metaDescription: page.metaDescription,
        h1: page.h1,
      });

      const guardResult = runGrowthGuard({
        draftContent,
        sourceContent: { title: page.title, metaDescription: page.metaDescription },
        aiDisclosure: true,
        recentDraftsForCustomer,
      });

      const status = decideActionStatus(guardResult.outcome, customer.autoExecuteEnabled);

      await db.action.create({
        data: {
          customerId: customer.id,
          pageUrl: page.url,
          actionType: 'meta_description',
          currentValue: page.metaDescription,
          draftContent,
          aiDisclosure: true,
          status,
          tokenCost,
          guardResult: {
            create: {
              outcome: guardResult.outcome,
              checksRun: guardResult.checksRun as unknown as Prisma.InputJsonValue,
              reasoning: guardResult.reasoning,
            },
          },
        },
      });

      draftsCreated += 1;
    } catch (err) {
      console.error('Draft/guard failed for', page.url, err);
      errors.push({ url: page.url, error: err instanceof Error ? err.message : 'Unknown error' });
      continue;
    }
  }

  return {
    pagesScanned: snapshots.length,
    pagesFlagged: flagged.length,
    draftsCreated,
    errors,
  };
}
```

- [ ] **Step 5: Write `src/app/api/scan/process/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { runScanForCustomer } from '@/lib/run-scan';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const job = await db.scanJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    include: { customer: true },
  });

  if (!job) {
    return NextResponse.json({ processed: false });
  }

  await db.scanJob.update({ where: { id: job.id }, data: { status: 'running', startedAt: new Date() } });

  try {
    const result = await runScanForCustomer(job.customer);
    await db.scanJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        resultSummary: result as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ processed: true, jobId: job.id });
  } catch (err) {
    await db.scanJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    });
    return NextResponse.json({ processed: true, jobId: job.id, failed: true }, { status: 500 });
  }
}
```

`GET`, not `POST`: Vercel Cron Jobs invoke their configured path with a scheduled `GET` request, automatically attaching `Authorization: Bearer <CRON_SECRET>` when the project's `CRON_SECRET` environment variable is set — this route is written to match that exact invocation shape (Task 6 wires the actual `vercel.json` cron config). Note this route is intentionally excluded from any customer-facing UI or link — nothing in the app should ever call it except the cron scheduler (or a developer manually, for local testing, with a matching bearer token).

- [ ] **Step 6: Manual local verification**

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run build` — expect a clean build, confirm `/api/scan/process` is registered as a route.
Run: `npm run lint` — expect clean.

With `.env.local`'s `CRON_SECRET` set to some test value (e.g. `CRON_SECRET=test-secret-value`) and `npm run dev` running, manually enqueue a `ScanJob` row for an existing test customer (e.g. via `npx prisma studio` or a one-off script), then:

```bash
curl -i -H "Authorization: Bearer test-secret-value" http://localhost:3000/api/scan/process
```

Expected: `200 OK` with `{"processed":true,"jobId":"..."}` (or `{"processed":false}` if no queued job exists), and the `ScanJob` row's status updated to `completed` or `failed` in the database.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/run-scan.ts src/app/api/scan/process/route.ts .env.example
git commit -m "feat: add ScanJob model, extract scan pipeline into runScanForCustomer(), add cron worker route"
```

---

### Task 6: Cut Over `/api/scan` to Enqueue-Only, Wire Cron, Show Job Status

**Files:**
- Modify: `src/app/api/scan/route.ts`
- Modify: `src/middleware.ts`
- Modify: `src/app/dashboard/page.tsx`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `db.scanJob` (Task 5's schema addition) — this task does NOT call `runScanForCustomer` directly; only `process/route.ts` (Task 5) does.
- Produces: the final Week 4 deliverable — clicking "Scan my site" returns instantly regardless of how many pages there are, and the customer can see whether their scan is queued, running, completed, or failed.

- [ ] **Step 1: Rewrite `src/app/api/scan/route.ts`**

Replace the entire file with:

```ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer?.gscRefreshToken) {
    return NextResponse.json({ error: 'Connect Google Search Console first' }, { status: 400 });
  }

  await db.scanJob.create({ data: { customerId: customer.id, status: 'queued' } });

  return NextResponse.redirect(new URL('/dashboard', req.url));
}
```

This replaces the entire prior synchronous implementation — `runScanForCustomer` (Task 5) is now the only place that logic lives, called exclusively by `/api/scan/process`.

- [ ] **Step 2: Narrow the middleware matcher so the cron worker route isn't behind Clerk auth**

In `src/middleware.ts`, change:
```ts
  '/api/scan(.*)',
```
to:
```ts
  '/api/scan',
```

This protects exactly `/api/scan` (the enqueue endpoint, still customer-session-gated) but no longer matches `/api/scan/process`, which has its own `CRON_SECRET` check instead (Task 5) — a Clerk session was never going to be present on a cron-triggered request anyway. Leave every other line in `middleware.ts` — the `clerkMiddleware` call, `config.matcher` — exactly as-is.

- [ ] **Step 3: Write `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/scan/process", "schedule": "* * * * *" }
  ]
}
```

This only takes effect once deployed to Vercel with `CRON_SECRET` set as a project environment variable — it has no effect in local dev, where Task 5's manual `curl` verification is how the worker route gets exercised.

- [ ] **Step 4: Show the latest `ScanJob` status on `src/app/dashboard/page.tsx`**

Replace the entire file with:

```tsx
import { auth } from '@clerk/nextjs/server';
import { ensureCustomer, PENDING_WEBSITE_URL } from '@/lib/customer';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites } from '@/lib/gsc-client';
import { db } from '@/lib/db';

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

  const latestScanJob = siteSelected
    ? await db.scanJob.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } })
    : null;

  return (
    <main>
      <h1>Dashboard</h1>
      <div className="mt-2 flex gap-4 text-sm">
        <a href="/review" className="font-medium text-accent underline-offset-4 hover:underline">
          Review queue
        </a>
        <a href="/settings" className="font-medium text-accent underline-offset-4 hover:underline">
          Settings
        </a>
      </div>
      <p>Customer ID: {customer.id}</p>
      <p>GSC connected: {gscConnected ? 'yes' : 'no'}</p>

      {!gscConnected && <a href="/api/gsc/connect">Connect Google Search Console</a>}

      {gscConnected && !siteSelected && (
        <>
          {siteListError && <p>{siteListError}</p>}
          {!siteListError && verifiedSites.length === 0 && (
            <p>No verified Search Console properties found for this account.</p>
          )}
          {!siteListError && verifiedSites.length > 0 && (
            <form action="/api/gsc/select-site" method="post">
              <label htmlFor="siteUrl">Choose a verified property:</label>
              <select name="siteUrl" id="siteUrl">
                {verifiedSites.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </select>
              <button type="submit">Use this site</button>
            </form>
          )}
        </>
      )}

      {siteSelected && (
        <>
          <p>Site: {customer.websiteUrl}</p>
          <form action="/api/scan" method="post">
            <button type="submit">Scan my site</button>
          </form>
          {latestScanJob && (
            <p className="mt-2 text-sm text-muted-foreground">
              Last scan: {latestScanJob.status === 'queued' && 'waiting to start'}
              {latestScanJob.status === 'running' && 'in progress'}
              {latestScanJob.status === 'completed' && 'completed'}
              {latestScanJob.status === 'failed' && `failed (${latestScanJob.error ?? 'unknown error'})`}
            </p>
          )}
        </>
      )}
    </main>
  );
}
```

The only changes from the current file: the `db` import, the `latestScanJob` query, and the status paragraph rendered under the "Scan my site" button. Everything else is unchanged.

- [ ] **Step 5: Type-check, build, lint, full test suite**

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run build` — expect a clean build; confirm `/api/scan` still registers, `/api/scan/process` still registers.
Run: `npm run lint` — expect clean.
Run: `npx vitest run` — expect all tests passing, no regressions (this task adds no new tests — pure route/UI wiring on top of Task 5's already-tested-by-manual-verification extraction).

- [ ] **Step 6: Manual end-to-end verification**

With `npm run dev` running and signed in as a test customer with GSC connected and a site selected:

1. Click "Scan my site" — expect an immediate redirect back to `/dashboard` (no multi-second wait), with "Last scan: waiting to start" shown.
2. Run the same `curl` command from Task 5 Step 6 against `/api/scan/process` with the correct `CRON_SECRET` — confirm it picks up the job just created.
3. Reload `/dashboard` — expect "Last scan: completed" (or "failed (...)" if the pipeline hit a real error, e.g. no OpenAI key configured locally — that's expected in this environment, confirms the failure path works too).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/scan/route.ts src/middleware.ts src/app/dashboard/page.tsx vercel.json
git commit -m "feat: cut /api/scan over to enqueue-only, wire Vercel Cron worker, show scan job status on dashboard"
```
