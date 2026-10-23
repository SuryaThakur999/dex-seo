# GSC Outcome-Window Linking + Evidence Pack Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5 of `docs/superpowers/plans/2026-09-08-assurance-loop-foundation.md`. Automatically measure whether a decided action helped (GSC before/after performance), and let a customer download a PDF evidence pack per action (the change, the safety check, and the measured outcome).

**Architecture:** Full design in `docs/superpowers/specs/2026-09-08-gsc-outcome-window-evidence-pack-design.md` — read that first for the "why" behind every decision below (Vercel Cron over a manual button, 28-day window reusing the existing constant, real PDF over HTML/JSON). This plan is the executable task breakdown of that design, corrected for one gap the design review caught: `gscRefreshToken` is stored **encrypted** (`src/lib/crypto.ts`), exactly as `src/lib/run-scan.ts:48` already handles — every task below that touches a refresh token calls `decrypt()` first.

**Tech Stack:** Same as Phases 1-3 — Next.js 14, Prisma + PostgreSQL, Vitest, Clerk auth, `googleapis` (existing GSC client). New dependency: `@react-pdf/renderer@^4.9.0` (verified: exports `renderToBuffer`, peer-supports React `^18.0.0` — matches this app's `react@^18.3.1`).

## Global Constraints

Same as prior phases (test-per-change, no `git add -A`, real migrations, commit convention ending in the Co-Authored-By/Claude-Session trailer, CLAUDE.md senior-developer + skill-routing rules). This project is on **Vercel Hobby tier**: `vercel.json` cron entries are limited to once-daily schedules (confirmed via `git show ff29e9d` — an every-minute schedule was previously rejected at deploy time and replaced with an external scheduler for that one high-frequency job). This phase's cron is once-daily, so a `vercel.json` is safe to add — it does not touch or conflict with `/api/scan/process`'s existing external-scheduler setup. Reuse the exact `CRON_SECRET` bearer-auth pattern already established at `src/app/api/scan/process/route.ts:14-17` — do not invent a different auth check.

---

### Task 1: Generalize `gsc-client.ts` to accept an explicit date range

**Files:**
- Modify: `src/lib/gsc-client.ts`
- Modify: `src/lib/gsc-client.test.ts`

**Interfaces:**
- Produces: `export async function getPagePerformanceForRange(refreshToken: string, siteUrl: string, startDate: string, endDate: string): Promise<PagePerformance[]>` (dates are `YYYY-MM-DD`) and `export function findPagePerformance(performance: PagePerformance[], pageUrl: string): { impressions: number; clicks: number; ctr: number }`. Tasks 3 and 4 consume both. `listPagePerformance`'s existing signature and behavior are unchanged (same 28-day-trailing-as-of-today default) — `src/lib/run-scan.ts:50`, its only caller, needs no changes.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/gsc-client.test.ts`, after the existing `describe('mergeSitemapUrls', ...)` block:

```typescript
describe('findPagePerformance', () => {
  it('returns the matching page metrics when present', () => {
    const performance = [
      { url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 },
      { url: 'https://example.com/b', impressions: 12, clicks: 0, ctr: 0 },
    ];
    expect(findPagePerformance(performance, 'https://example.com/b')).toEqual({ impressions: 12, clicks: 0, ctr: 0 });
  });

  it('returns zeroed metrics when the page has no GSC data in this window', () => {
    const performance = [{ url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 }];
    expect(findPagePerformance(performance, 'https://example.com/missing')).toEqual({ impressions: 0, clicks: 0, ctr: 0 });
  });
});
```

Add `findPagePerformance` to the import at the top of the file:

```typescript
import { extractPageUrls, extractPagePerformance, fetchSitemapUrls, mergeSitemapUrls, findPagePerformance } from './gsc-client';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/surya/Projects/dex-ai
npx vitest run src/lib/gsc-client.test.ts
```

Expected: FAIL — `findPagePerformance` is not exported yet.

- [ ] **Step 3: Refactor the implementation**

In `src/lib/gsc-client.ts`, replace the private `queryPagePerformance` function and `listPagePerformance` (currently lines 31-50) with:

```typescript
async function queryPagePerformanceForRange(
  refreshToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<SearchAnalyticsResponse> {
  const auth = client();
  auth.setCredentials({ refresh_token: refreshToken });

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const { data } = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: ROW_LIMIT,
    },
  });
  return data;
}

export async function getPagePerformanceForRange(
  refreshToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string
): Promise<PagePerformance[]> {
  return extractPagePerformance(await queryPagePerformanceForRange(refreshToken, siteUrl, startDate, endDate));
}

export async function listPagePerformance(refreshToken: string, siteUrl: string): Promise<PagePerformance[]> {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return getPagePerformanceForRange(refreshToken, siteUrl, startDate, endDate);
}
```

Add `findPagePerformance` after `mergeSitemapUrls` (at the end of the file):

```typescript
export function findPagePerformance(performance: PagePerformance[], pageUrl: string): { impressions: number; clicks: number; ctr: number } {
  const match = performance.find((page) => page.url === pageUrl);
  return match ? { impressions: match.impressions, clicks: match.clicks, ctr: match.ctr } : { impressions: 0, clicks: 0, ctr: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/gsc-client.test.ts
```

Expected: PASS, all cases including the 2 new ones.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all 163 tests pass (161 existing + 2 new — `listPagePerformance`'s network-calling behavior was never unit-tested before this change either, matching existing convention, so no test needed for it here beyond the refactor not breaking `run-scan.test.ts`'s mock of it).

- [ ] **Step 6: Commit**

```bash
git add src/lib/gsc-client.ts src/lib/gsc-client.test.ts
git commit -m "feat: generalize gsc-client to accept an explicit date range

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 2: Add outcome-tracking fields to `Action`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Action.baselinePerformance Json?`, `Action.baselineCapturedAt DateTime?`, `Action.outcomePerformance Json?`, `Action.outcomeMeasuredAt DateTime?`. Tasks 3, 4, and 6 read/write these.

- [ ] **Step 1: Add the fields**

In `prisma/schema.prisma`, in the `Action` model, add after `decidedAt DateTime?`:

```prisma
model Action {
  id            String       @id @default(cuid())
  customerId    String
  customer      Customer     @relation(fields: [customerId], references: [id])
  pageUrl       String
  actionType    String
  currentValue  String?
  draftContent  String
  aiDisclosure  Boolean      @default(true)
  guardResult   GuardResult?
  status        ActionStatus @default(pending)
  riskTier      RiskTier     @default(low)
  policyVersion String       @default("v1")
  tokenCost     Int?
  createdAt     DateTime     @default(now())
  decidedAt     DateTime?
  baselinePerformance Json?
  baselineCapturedAt  DateTime?
  outcomePerformance  Json?
  outcomeMeasuredAt   DateTime?
}
```

- [ ] **Step 2: Migrate**

```bash
cd /Users/surya/Projects/dex-ai
set -a; source <(grep -v '^#' .env.local | grep '='); set +a
npx prisma migrate dev --name add_action_outcome_tracking 2>&1
```

If this errors as non-interactive, hand-write the migration folder (`ALTER TABLE "Action" ADD COLUMN "baselinePerformance" JSONB, ADD COLUMN "baselineCapturedAt" TIMESTAMP(3), ADD COLUMN "outcomePerformance" JSONB, ADD COLUMN "outcomeMeasuredAt" TIMESTAMP(3);`), then `npx prisma migrate deploy`.

- [ ] **Step 3: Generate client, run tests**

```bash
npx prisma generate
npm test
```

Expected: all 163 tests still pass (additive schema change, nothing references the new fields yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add outcome-tracking fields to Action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 3: Capture baseline GSC performance on approve/edit

**Files:**
- Modify: `src/app/api/actions/[actionId]/approve/route.ts`
- Modify: `src/app/api/actions/[actionId]/approve/route.test.ts`
- Modify: `src/app/api/actions/[actionId]/edit/route.ts`
- Modify: `src/app/api/actions/[actionId]/edit/route.test.ts`

**Interfaces:**
- Consumes: `listPagePerformance`, `findPagePerformance` from `@/lib/gsc-client` (Task 1); `decrypt` from `@/lib/crypto` (existing, used identically by `src/lib/run-scan.ts:48`).
- Produces: both routes now set `baselinePerformance`/`baselineCapturedAt` on the `Action` row when the customer has GSC connected and the fetch succeeds. Task 4 (the cron) reads these two fields.

- [ ] **Step 1: Write the failing tests for `approve/route.ts`**

Add to `src/app/api/actions/[actionId]/approve/route.test.ts`, changing the mock setup at the top:

```typescript
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

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((token: string) => `decrypted-${token}`),
}));

vi.mock('@/lib/gsc-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gsc-client')>();
  return { ...actual, listPagePerformance: vi.fn() };
});
```

Add these imports alongside the existing ones:

```typescript
import { listPagePerformance } from '@/lib/gsc-client';
```

Add these three test cases inside the `describe('POST /api/actions/[actionId]/approve', ...)` block, after the existing "approves a pending, non-blocked action" test:

```typescript
  it('captures baseline GSC performance when the customer has GSC connected', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...CUSTOMER,
      gscRefreshToken: 'encrypted-token',
      websiteUrl: 'https://example.com',
    });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      guardResult: { outcome: 'pass' },
    });
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue([
      { url: 'https://example.com/a', impressions: 100, clicks: 5, ctr: 0.05 },
    ]);

    await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(listPagePerformance).toHaveBeenCalledWith('decrypted-encrypted-token', 'https://example.com');
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.baselinePerformance).toEqual({ impressions: 100, clicks: 5, ctr: 0.05 });
    expect(updateArgs.data.baselineCapturedAt).toBeInstanceOf(Date);
  });

  it('approves without a baseline when the customer has no GSC connected', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...CUSTOMER, gscRefreshToken: null });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      guardResult: { outcome: 'pass' },
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    expect(listPagePerformance).not.toHaveBeenCalled();
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.baselinePerformance).toBeUndefined();
    expect(updateArgs.data.baselineCapturedAt).toBeUndefined();
  });

  it('approves without a baseline when the GSC fetch fails', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...CUSTOMER,
      gscRefreshToken: 'encrypted-token',
      websiteUrl: 'https://example.com',
    });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      guardResult: { outcome: 'pass' },
    });
    (listPagePerformance as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('token revoked'));

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.baselinePerformance).toBeUndefined();
  });
```

The existing `CUSTOMER` constant (`{ id: 'cust_1', clerkUserId: 'user_1' }`) needs `websiteUrl` for the non-null-GSC tests above to have somewhere to read it from — those tests spread `...CUSTOMER` with an explicit override, so no change to the shared constant is needed.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/actions/\[actionId\]/approve/route.test.ts
```

Expected: FAIL — `listPagePerformance` is never called, `updateArgs.data.baselinePerformance` is `undefined` in the success case where it should be defined.

- [ ] **Step 3: Update `approve/route.ts`**

Replace the full file with:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { buildAuditLogEntryArgs } from '@/lib/audit-log';
import { decrypt } from '@/lib/crypto';
import { listPagePerformance, findPagePerformance } from '@/lib/gsc-client';

export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId }, include: { guardResult: true } });
  if (!action || action.customerId !== customer.id || action.status !== 'pending') {
    return NextResponse.json({ error: 'Action not found or already decided' }, { status: 404 });
  }
  if (action.guardResult?.outcome === 'block') {
    return NextResponse.json({ error: 'Blocked drafts cannot be approved' }, { status: 400 });
  }

  let baselineFields: { baselinePerformance: Prisma.InputJsonValue; baselineCapturedAt: Date } | Record<string, never> = {};
  if (customer.gscRefreshToken) {
    try {
      const performance = await listPagePerformance(decrypt(customer.gscRefreshToken), customer.websiteUrl);
      baselineFields = {
        baselinePerformance: findPagePerformance(performance, action.pageUrl) as unknown as Prisma.InputJsonValue,
        baselineCapturedAt: new Date(),
      };
    } catch {
      // GSC call failed (revoked token, transient API error, etc.) — approve still succeeds,
      // baseline stays null, and this action is simply never picked up by the outcome cron.
    }
  }

  await db.$transaction([
    db.action.update({ where: { id: action.id }, data: { status: 'approved', decidedAt: new Date(), ...baselineFields } }),
    db.auditLogEntry.create(buildAuditLogEntryArgs(customer.id, 'action_decided', { decision: 'approved', pageUrl: action.pageUrl }, action.id)),
  ]);

  return NextResponse.redirect(new URL(`/review/${action.id}`, req.url));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/api/actions/\[actionId\]/approve/route.test.ts
```

Expected: PASS, 8/8 (5 existing + 3 new).

- [ ] **Step 5: Repeat for `edit/route.ts` — write the failing tests**

Add the same three mocks (`crypto`, `gsc-client`) and `listPagePerformance` import to `src/app/api/actions/[actionId]/edit/route.test.ts`'s existing mock setup (its `db` mock already exists from Phase 3 — only add the two new `vi.mock` blocks and the import, don't duplicate the `db` mock).

Add three parallel test cases (same shape as approve's, adapted to `edit`'s `makeRequest('New text.')` helper and the fact that `edit` requires a `draftContent` form field):

```typescript
  it('captures baseline GSC performance when the customer has GSC connected', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...CUSTOMER,
      gscRefreshToken: 'encrypted-token',
      websiteUrl: 'https://example.com',
    });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      draftContent: 'Original AI draft.',
    });
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue([
      { url: 'https://example.com/a', impressions: 100, clicks: 5, ctr: 0.05 },
    ]);

    await POST(makeRequest('Edited by the customer.'), { params: { actionId: 'action_1' } });

    expect(listPagePerformance).toHaveBeenCalledWith('decrypted-encrypted-token', 'https://example.com');
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.baselinePerformance).toEqual({ impressions: 100, clicks: 5, ctr: 0.05 });
    expect(updateArgs.data.baselineCapturedAt).toBeInstanceOf(Date);
  });

  it('edits without a baseline when the customer has no GSC connected', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...CUSTOMER, gscRefreshToken: null });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      draftContent: 'Original AI draft.',
    });

    const res = await POST(makeRequest('Edited by the customer.'), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    expect(listPagePerformance).not.toHaveBeenCalled();
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.baselinePerformance).toBeUndefined();
  });

  it('edits without a baseline when the GSC fetch fails', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...CUSTOMER,
      gscRefreshToken: 'encrypted-token',
      websiteUrl: 'https://example.com',
    });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      draftContent: 'Original AI draft.',
    });
    (listPagePerformance as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('token revoked'));

    const res = await POST(makeRequest('Edited by the customer.'), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data.baselinePerformance).toBeUndefined();
  });
```

- [ ] **Step 6: Run tests to verify they fail, then update `edit/route.ts`**

```bash
npx vitest run src/app/api/actions/\[actionId\]/edit/route.test.ts
```

Expected: FAIL for the same reasons as approve's.

Replace the full file with:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { buildAuditLogEntryArgs } from '@/lib/audit-log';
import { decrypt } from '@/lib/crypto';
import { listPagePerformance, findPagePerformance } from '@/lib/gsc-client';

export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId } });
  if (!action || action.customerId !== customer.id || action.status !== 'pending') {
    return NextResponse.json({ error: 'Action not found or already decided' }, { status: 404 });
  }

  const form = await req.formData();
  const draftContent = form.get('draftContent');
  if (typeof draftContent !== 'string' || !draftContent.trim()) {
    return NextResponse.json({ error: 'Edited content cannot be empty' }, { status: 400 });
  }

  let baselineFields: { baselinePerformance: Prisma.InputJsonValue; baselineCapturedAt: Date } | Record<string, never> = {};
  if (customer.gscRefreshToken) {
    try {
      const performance = await listPagePerformance(decrypt(customer.gscRefreshToken), customer.websiteUrl);
      baselineFields = {
        baselinePerformance: findPagePerformance(performance, action.pageUrl) as unknown as Prisma.InputJsonValue,
        baselineCapturedAt: new Date(),
      };
    } catch {
      // GSC call failed — edit still succeeds, baseline stays null.
    }
  }

  await db.$transaction([
    db.action.update({
      where: { id: action.id },
      data: { draftContent: draftContent.trim(), status: 'edited', decidedAt: new Date(), ...baselineFields },
    }),
    db.auditLogEntry.create(
      buildAuditLogEntryArgs(
        customer.id,
        'action_decided',
        { decision: 'edited', pageUrl: action.pageUrl, originalDraftContent: action.draftContent },
        action.id
      )
    ),
  ]);

  return NextResponse.redirect(new URL(`/review/${action.id}`, req.url));
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx vitest run src/app/api/actions/\[actionId\]/edit/route.test.ts
```

Expected: PASS, 9/9 (6 existing from Phase 3 + 3 new).

- [ ] **Step 8: Run the full test suite**

```bash
npm test
```

Expected: all 169 tests pass (163 from Task 2 + 3 approve + 3 edit).

- [ ] **Step 9: Commit**

```bash
git add src/app/api/actions/\[actionId\]/approve src/app/api/actions/\[actionId\]/edit
git commit -m "feat: capture baseline GSC performance when a decision is made

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 4: Outcome-measurement cron

**Files:**
- Create: `src/app/api/cron/measure-outcomes/route.ts`
- Create: `src/app/api/cron/measure-outcomes/route.test.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `getPagePerformanceForRange`, `findPagePerformance` from `@/lib/gsc-client` (Task 1); `decrypt` from `@/lib/crypto`; `baselineCapturedAt`/`outcomeMeasuredAt` from `Action` (Task 2).
- Produces: `GET` handler at `/api/cron/measure-outcomes`, auth-gated identically to `src/app/api/scan/process/route.ts:14-17`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/cron/measure-outcomes/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { getPagePerformanceForRange } from '@/lib/gsc-client';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((token: string) => `decrypted-${token}`),
}));

vi.mock('@/lib/gsc-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gsc-client')>();
  return { ...actual, getPagePerformanceForRange: vi.fn() };
});

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request('http://localhost:3000/api/cron/measure-outcomes', { headers }) as unknown as NextRequest;
}

describe('GET /api/cron/measure-outcomes', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it('returns 401 when the bearer token is missing or wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(db.action.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(makeRequest('Bearer undefined'));

    expect(res.status).toBe(401);
  });

  it('returns zeroed counts when there are no candidate actions', async () => {
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(body).toEqual({ processed: 0, succeeded: 0, failed: 0 });
  });

  it('measures and stores the outcome for a candidate action', async () => {
    const baselineCapturedAt = new Date('2026-01-01T00:00:00Z');
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'action_1',
        pageUrl: 'https://example.com/a',
        baselineCapturedAt,
        customer: { gscRefreshToken: 'encrypted-token', websiteUrl: 'https://example.com' },
      },
    ]);
    (getPagePerformanceForRange as ReturnType<typeof vi.fn>).mockResolvedValue([
      { url: 'https://example.com/a', impressions: 150, clicks: 9, ctr: 0.06 },
    ]);

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(getPagePerformanceForRange).toHaveBeenCalledWith(
      'decrypted-encrypted-token',
      'https://example.com',
      '2026-01-01',
      '2026-01-29'
    );
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'action_1' });
    expect(updateArgs.data.outcomePerformance).toEqual({ impressions: 150, clicks: 9, ctr: 0.06 });
    expect(updateArgs.data.outcomeMeasuredAt).toBeInstanceOf(Date);
    expect(body).toEqual({ processed: 1, succeeded: 1, failed: 0 });
  });

  it('continues past a failing candidate instead of aborting the run', async () => {
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'action_fail',
        pageUrl: 'https://example.com/a',
        baselineCapturedAt: new Date('2026-01-01T00:00:00Z'),
        customer: { gscRefreshToken: 'encrypted-token', websiteUrl: 'https://example.com' },
      },
      {
        id: 'action_ok',
        pageUrl: 'https://example.com/b',
        baselineCapturedAt: new Date('2026-01-01T00:00:00Z'),
        customer: { gscRefreshToken: 'encrypted-token', websiteUrl: 'https://example.com' },
      },
    ]);
    (getPagePerformanceForRange as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('token revoked'))
      .mockResolvedValueOnce([{ url: 'https://example.com/b', impressions: 20, clicks: 1, ctr: 0.05 }]);

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(db.action.update).toHaveBeenCalledTimes(1);
    expect((db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ id: 'action_ok' });
    expect(body).toEqual({ processed: 2, succeeded: 1, failed: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/cron/measure-outcomes/route.test.ts
```

Expected: FAIL — `./route` cannot be found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/cron/measure-outcomes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getPagePerformanceForRange, findPagePerformance } from '@/lib/gsc-client';

const WINDOW_DAYS = 28;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db.action.findMany({
    where: {
      status: { in: ['approved', 'edited'] },
      baselineCapturedAt: { not: null, lte: cutoff },
      outcomeMeasuredAt: null,
      customer: { gscRefreshToken: { not: null } },
    },
    include: { customer: true },
  });

  let succeeded = 0;
  let failed = 0;
  for (const action of candidates) {
    try {
      const windowStart = action.baselineCapturedAt!;
      const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const performance = await getPagePerformanceForRange(
        decrypt(action.customer.gscRefreshToken!),
        action.customer.websiteUrl,
        windowStart.toISOString().slice(0, 10),
        windowEnd.toISOString().slice(0, 10)
      );
      await db.action.update({
        where: { id: action.id },
        data: {
          outcomePerformance: findPagePerformance(performance, action.pageUrl) as unknown as Prisma.InputJsonValue,
          outcomeMeasuredAt: new Date(),
        },
      });
      succeeded++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ processed: candidates.length, succeeded, failed });
}
```

- [ ] **Step 4: Add the Vercel Cron entry**

Create `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/measure-outcomes", "schedule": "0 6 * * *" }]
}
```

This is a once-daily schedule, within Vercel Hobby tier's limit (unlike `/api/scan/process`'s prior every-minute schedule, which was removed in favor of an external scheduler — see `git show ff29e9d`). This file does not reference `/api/scan/process` and does not change how that route is triggered.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/app/api/cron/measure-outcomes/route.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all 174 tests pass (169 from Task 3 + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/measure-outcomes vercel.json
git commit -m "feat: add daily cron to measure GSC outcomes 28 days after a decision

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 5: Evidence pack PDF generator

**Files:**
- Create: `src/lib/evidence-pdf.tsx`
- Create: `src/lib/evidence-pdf.test.ts`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Produces: `export interface EvidencePdfInput { pageUrl: string; status: 'approved' | 'edited'; decidedAt: Date; currentValue: string | null; draftContent: string; riskTier: string; guardResult: { outcome: string; reasoning: string; checksRun: ProofCheckResult[] } | null; baselinePerformance: { impressions: number; clicks: number; ctr: number } | null; outcomePerformance: { impressions: number; clicks: number; ctr: number } | null; outcomeMeasuredAt: Date | null; }` and `export async function renderEvidencePdf(input: EvidencePdfInput): Promise<Buffer>`. Task 6 consumes both.
- Consumes: `computeDiff`, `DiffSegment` from `@/lib/diff` (Phase 3); `ProofCheckResult` from `@/lib/proof-layer`; `OUTCOME_LABEL`, `RISK_TIER_LABEL`, `CHECK_LABEL` from `@/lib/guard-outcome-ui` (existing, pure string maps — safe to import into a PDF-generation module).

- [ ] **Step 1: Install the dependency**

```bash
cd /Users/surya/Projects/dex-ai
npm install @react-pdf/renderer@^4.9.0
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/lib/evidence-pdf.test.ts
import { describe, it, expect } from 'vitest';
import { renderEvidencePdf } from './evidence-pdf';

describe('renderEvidencePdf', () => {
  it('renders a non-empty PDF for a fully measured action', async () => {
    const buffer = await renderEvidencePdf({
      pageUrl: 'https://example.com/a',
      status: 'approved',
      decidedAt: new Date('2026-01-01'),
      currentValue: 'Old text.',
      draftContent: 'New text.',
      riskTier: 'low',
      guardResult: {
        outcome: 'pass',
        reasoning: 'All checks passed.',
        checksRun: [{ check: 'length-format', result: 'pass', detail: 'Within range.' }],
      },
      baselinePerformance: { impressions: 100, clicks: 5, ctr: 0.05 },
      outcomePerformance: { impressions: 150, clicks: 9, ctr: 0.06 },
      outcomeMeasuredAt: new Date('2026-01-29'),
    });

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('renders a pending-outcome PDF when the action has not yet been measured', async () => {
    const buffer = await renderEvidencePdf({
      pageUrl: 'https://example.com/a',
      status: 'edited',
      decidedAt: new Date('2026-01-01'),
      currentValue: null,
      draftContent: 'New text.',
      riskTier: 'medium',
      guardResult: null,
      baselinePerformance: null,
      outcomePerformance: null,
      outcomeMeasuredAt: null,
    });

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/lib/evidence-pdf.test.ts
```

Expected: FAIL — `./evidence-pdf` has no exported member `renderEvidencePdf` (module doesn't exist yet).

- [ ] **Step 4: Write the implementation**

```tsx
// src/lib/evidence-pdf.tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { computeDiff } from '@/lib/diff';
import type { ProofCheckResult } from '@/lib/proof-layer';
import { OUTCOME_LABEL, RISK_TIER_LABEL, CHECK_LABEL } from '@/lib/guard-outcome-ui';

export interface EvidencePdfInput {
  pageUrl: string;
  status: 'approved' | 'edited';
  decidedAt: Date;
  currentValue: string | null;
  draftContent: string;
  riskTier: string;
  guardResult: { outcome: string; reasoning: string; checksRun: ProofCheckResult[] } | null;
  baselinePerformance: { impressions: number; clicks: number; ctr: number } | null;
  outcomePerformance: { impressions: number; clicks: number; ctr: number } | null;
  outcomeMeasuredAt: Date | null;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  heading: { fontSize: 18, marginBottom: 12, fontFamily: 'Helvetica-Bold' },
  sectionTitle: { fontSize: 13, marginTop: 16, marginBottom: 6, fontFamily: 'Helvetica-Bold' },
  meta: { marginBottom: 3, color: '#374151' },
  diffText: { lineHeight: 1.5 },
  added: { backgroundColor: '#10b981', color: '#ffffff' },
  removed: { backgroundColor: '#f87171', color: '#ffffff', textDecoration: 'line-through' },
  checkLine: { marginBottom: 2 },
});

function formatDelta(before: number, after: number): string {
  const change = after - before;
  const sign = change >= 0 ? '+' : '';
  if (before === 0) return `${before} -> ${after} (${sign}${change})`;
  const pct = (change / before) * 100;
  return `${before} -> ${after} (${sign}${change}, ${sign}${pct.toFixed(1)}%)`;
}

export async function renderEvidencePdf(input: EvidencePdfInput): Promise<Buffer> {
  const diff = computeDiff(input.currentValue ?? '', input.draftContent);
  const hasOutcome = Boolean(input.outcomeMeasuredAt && input.baselinePerformance && input.outcomePerformance);

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.heading}>Dex Evidence Pack</Text>
        <Text style={styles.meta}>{input.pageUrl}</Text>
        <Text style={styles.meta}>
          {input.status === 'approved' ? 'Approved' : 'Edited'} on {input.decidedAt.toLocaleDateString()}
        </Text>

        <Text style={styles.sectionTitle}>What changed</Text>
        <Text style={styles.diffText}>
          {diff.map((segment, index) => (
            <Text
              key={index}
              style={segment.type === 'added' ? styles.added : segment.type === 'removed' ? styles.removed : undefined}
            >
              {segment.value}
            </Text>
          ))}
        </Text>

        <Text style={styles.sectionTitle}>ProofLayer result</Text>
        {input.guardResult ? (
          <View>
            <Text style={styles.meta}>Outcome: {OUTCOME_LABEL[input.guardResult.outcome] ?? input.guardResult.outcome}</Text>
            <Text style={styles.meta}>Risk tier: {RISK_TIER_LABEL[input.riskTier] ?? input.riskTier}</Text>
            {input.guardResult.checksRun.map((check) => (
              <Text key={check.check} style={styles.checkLine}>
                {check.result === 'pass' ? '[pass]' : '[fail]'} {CHECK_LABEL[check.check] ?? check.check}: {check.detail}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>No ProofLayer result recorded.</Text>
        )}

        <Text style={styles.sectionTitle}>GSC outcome</Text>
        {hasOutcome ? (
          <View>
            <Text style={styles.checkLine}>Impressions: {formatDelta(input.baselinePerformance!.impressions, input.outcomePerformance!.impressions)}</Text>
            <Text style={styles.checkLine}>Clicks: {formatDelta(input.baselinePerformance!.clicks, input.outcomePerformance!.clicks)}</Text>
            <Text style={styles.checkLine}>CTR: {formatDelta(input.baselinePerformance!.ctr, input.outcomePerformance!.ctr)}</Text>
          </View>
        ) : (
          <Text style={styles.meta}>Outcome measurement pending — available 28 days after this decision.</Text>
        )}
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/lib/evidence-pdf.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all 176 tests pass (174 from Task 4 + 2 new).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/evidence-pdf.tsx src/lib/evidence-pdf.test.ts
git commit -m "feat: add evidence pack PDF generator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 6: Evidence pack download route

**Files:**
- Create: `src/app/api/actions/[actionId]/evidence/route.ts`
- Create: `src/app/api/actions/[actionId]/evidence/route.test.ts`

**Interfaces:**
- Consumes: `renderEvidencePdf` from `@/lib/evidence-pdf` (Task 5); `db`, `auth` following the exact pattern of every sibling action route.
- Produces: `GET` handler at `/api/actions/[actionId]/evidence`. Task 7 (UI) links to it.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/actions/[actionId]/evidence/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { renderEvidencePdf } from '@/lib/evidence-pdf';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { findUnique: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/evidence-pdf', () => ({
  renderEvidencePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake-content')),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/actions/action_1/evidence') as unknown as NextRequest;
}

const CUSTOMER = { id: 'cust_1', clerkUserId: 'user_1' };

describe('GET /api/actions/[actionId]/evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the action belongs to a different customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'someone_elses_customer_id',
      status: 'approved',
    });

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
  });

  it('returns 400 for a pending action', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
    });

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(400);
    expect(renderEvidencePdf).not.toHaveBeenCalled();
  });

  it('returns 400 for a rejected action', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'rejected',
    });

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(400);
  });

  it('returns a PDF with the correct headers for an approved action', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'approved',
      pageUrl: 'https://example.com/a',
      decidedAt: new Date('2026-01-01'),
      currentValue: 'Old text.',
      draftContent: 'New text.',
      riskTier: 'low',
      baselinePerformance: null,
      outcomePerformance: null,
      outcomeMeasuredAt: null,
      guardResult: { outcome: 'pass', reasoning: 'ok', checksRun: [] },
    });

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="dex-evidence-action_1.pdf"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/actions/\[actionId\]/evidence/route.test.ts
```

Expected: FAIL — `./route` cannot be found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/actions/[actionId]/evidence/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { renderEvidencePdf } from '@/lib/evidence-pdf';
import type { ProofCheckResult } from '@/lib/proof-layer';

export async function GET(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId }, include: { guardResult: true } });
  if (!action || action.customerId !== customer.id) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 });
  }
  if (action.status !== 'approved' && action.status !== 'edited') {
    return NextResponse.json({ error: 'No evidence pack for an undecided or rejected action' }, { status: 400 });
  }

  const pdfBuffer = await renderEvidencePdf({
    pageUrl: action.pageUrl,
    status: action.status,
    decidedAt: action.decidedAt!,
    currentValue: action.currentValue,
    draftContent: action.draftContent,
    riskTier: action.riskTier,
    guardResult: action.guardResult
      ? {
          outcome: action.guardResult.outcome,
          reasoning: action.guardResult.reasoning,
          checksRun: action.guardResult.checksRun as unknown as ProofCheckResult[],
        }
      : null,
    baselinePerformance: action.baselinePerformance as { impressions: number; clicks: number; ctr: number } | null,
    outcomePerformance: action.outcomePerformance as { impressions: number; clicks: number; ctr: number } | null,
    outcomeMeasuredAt: action.outcomeMeasuredAt,
  });

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="dex-evidence-${action.id}.pdf"`,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/api/actions/\[actionId\]/evidence/route.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all 181 tests pass (176 from Task 5 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/actions/\[actionId\]/evidence
git commit -m "feat: add evidence pack download route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 7: Surface the download link on the review detail page

**Files:**
- Modify: `src/app/review/[actionId]/page.tsx`

**Interfaces:**
- Consumes: `/api/actions/${action.id}/evidence` (Task 6), via a plain link — no new function interfaces.

- [ ] **Step 1: Read the current `isFinal` block to confirm the exact text to replace**

Current (post-Phase-3) `isFinal` block in `src/app/review/[actionId]/page.tsx`:

```tsx
      {isFinal && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ready to apply</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Copy this into your site&apos;s meta description field. Dex doesn&apos;t write directly to your CMS in
              this version.
            </p>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <code className="flex-1 text-sm text-foreground">{action.draftContent}</code>
              <CopyButton text={action.draftContent} />
            </div>
            <form action={`/api/actions/${action.id}/revert`} method="post" className="mt-3">
              <Button type="submit" variant="outline" size="sm">
                Undo this decision
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 2: Add the download link**

Replace the `<form>` line and its closing tag with (adding the evidence-pack link right after the existing Undo form, same `flex` row):

```tsx
            <div className="mt-3 flex flex-wrap gap-3">
              <form action={`/api/actions/${action.id}/revert`} method="post">
                <Button type="submit" variant="outline" size="sm">
                  Undo this decision
                </Button>
              </form>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/actions/${action.id}/evidence`}>Download evidence pack</a>
              </Button>
            </div>
```

- [ ] **Step 3: Run the full test suite one more time, then typecheck**

```bash
npm test
npx tsc --noEmit
```

Expected: all 181 tests pass, zero type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/review/\[actionId\]/page.tsx
git commit -m "feat: add evidence pack download link to review detail page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

## Self-Review

**Spec coverage:** The design's three architecture pieces — baseline capture, outcome cron, evidence pack — map to Task 3, Task 4, and Tasks 5-6 respectively; Task 1 is the shared `gsc-client.ts` prerequisite both baseline capture and the cron build on; Task 2 is the schema both depend on; Task 7 is the UI surface for the evidence pack. All "Out of scope (deferred)" items from the design (multi-action reports, manual trigger, historical backfill) have no corresponding task — correctly excluded.

**Placeholder scan:** No TBD/TODO. Every step has real, complete code. Test counts are tracked cumulatively task-to-task (163 -> 169 -> 174 -> 176 -> 181) so a mismatch surfaces immediately during execution rather than being silently wrong.

**Type consistency:** `EvidencePdfInput` (Task 5) is constructed field-for-field in Task 6's route handler — same field names, same types (`status: 'approved' | 'edited'` narrows from the broader `ActionStatus` enum via the route's own `if` guard just above the construction, so no type-widening mismatch). `findPagePerformance`'s return shape (`{ impressions, clicks, ctr }`, no `url`) matches exactly what's stored in `baselinePerformance`/`outcomePerformance` (Task 3, Task 4) and exactly what `EvidencePdfInput` expects (Task 5/6). The `CRON_SECRET` auth block in Task 4 is copied verbatim from `src/app/api/scan/process/route.ts:14-17`, not re-derived — this specific piece of test-critical logic (fail-closed on unset secret) was already hardened by a whole-branch review in that phase (see `git log --oneline -- "**/process/route.ts"`, commit `fe5555e`), so re-implementing it independently would risk losing that hardening.
