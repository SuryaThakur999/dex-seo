# SafeDeploy Reversible Actions (Internal-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 of `docs/superpowers/plans/2026-09-08-assurance-loop-foundation.md`. Give a decided `Action` (approved/edited/rejected) a visible diff and a reversible decision — snapshot, diff, rollback — without building a live write-to-CMS pipeline, since no such pipeline exists yet: `/review/[actionId]/page.tsx` today tells the customer "Dex doesn't write directly to your CMS in this version" and every decision route (`approve`, `reject`, `edit`) only flips `Action.status` in the database. Real external writes (Shopify Admin API, WordPress, etc.) are out of scope for this phase — confirmed with the founder — and will be a later phase once a real write target exists.

**Architecture:** Three additions, none requiring a schema migration. (1) A pure `computeDiff` word-level diff utility, rendered on the review detail page in place of the plain two-card current/draft comparison. (2) The `edit` route starts recording the pre-edit `draftContent` inside its existing `AuditLogEntry.detail` JSON blob — this is the "snapshot," reusing the table that already exists rather than adding a new one. (3) A new `revert` route that flips a decided action back to `pending`, restoring the pre-edit draft content from that snapshot when the action being reverted is `edited`, and logs an `action_reverted` audit event.

**Tech Stack:** Same as Phases 1-2 — Next.js 14, Prisma + PostgreSQL, Vitest, Clerk auth.

## Global Constraints

Same as Phase 1/2's Global Constraints (test-per-change, no `git add -A`, real migrations when a migration is actually needed — none is needed in this phase, commit convention, CLAUDE.md senior-developer + skill-routing rules). No new npm dependency — the diff utility is small enough to hand-write (word-level LCS diff over strings under 200 characters), and `package.json` has no diff library today.

---

### Task 1: Add `computeDiff` word-level diff utility

**Files:**
- Create: `src/lib/diff.ts`
- Test: `src/lib/diff.test.ts`

**Interfaces:**
- Produces: `type DiffSegment = { type: 'equal' | 'added' | 'removed'; value: string }` and `function computeDiff(oldText: string, newText: string): DiffSegment[]`. Task 4 (UI) consumes both.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/diff.test.ts
import { describe, it, expect } from 'vitest';
import { computeDiff } from './diff';

describe('computeDiff', () => {
  it('returns a single equal segment for identical text', () => {
    expect(computeDiff('Fresh coffee, roasted daily.', 'Fresh coffee, roasted daily.')).toEqual([
      { type: 'equal', value: 'Fresh coffee, roasted daily.' },
    ]);
  });

  it('marks pure addition at the end as added', () => {
    const result = computeDiff('Fresh coffee.', 'Fresh coffee. Free shipping.');
    expect(result).toEqual([
      { type: 'equal', value: 'Fresh coffee.' },
      { type: 'added', value: ' Free shipping.' },
    ]);
  });

  it('marks pure removal as removed', () => {
    const result = computeDiff('Fresh coffee. Free shipping.', 'Fresh coffee.');
    expect(result).toEqual([
      { type: 'equal', value: 'Fresh coffee.' },
      { type: 'removed', value: ' Free shipping.' },
    ]);
  });

  it('marks a middle word replacement as removed then added', () => {
    const result = computeDiff('Buy cheap coffee online', 'Buy premium coffee online');
    expect(result).toEqual([
      { type: 'equal', value: 'Buy ' },
      { type: 'removed', value: 'cheap' },
      { type: 'added', value: 'premium' },
      { type: 'equal', value: ' coffee online' },
    ]);
  });

  it('treats an empty old value as all-added', () => {
    expect(computeDiff('', 'Brand new description.')).toEqual([
      { type: 'added', value: 'Brand new description.' },
    ]);
  });

  it('treats an empty new value as all-removed', () => {
    expect(computeDiff('Old description.', '')).toEqual([
      { type: 'removed', value: 'Old description.' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/surya/Projects/dex-ai
npx vitest run src/lib/diff.test.ts
```

Expected: FAIL — `./diff` has no exported member `computeDiff` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/diff.ts
export type DiffSegment = { type: 'equal' | 'added' | 'removed'; value: string };

function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [];
}

export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length;
  const n = b.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ type: 'removed', value: a[i] });
      i++;
    } else {
      raw.push({ type: 'added', value: b[j] });
      j++;
    }
  }
  while (i < m) {
    raw.push({ type: 'removed', value: a[i] });
    i++;
  }
  while (j < n) {
    raw.push({ type: 'added', value: b[j] });
    j++;
  }

  const merged: DiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) {
      last.value += seg.value;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/diff.test.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diff.ts src/lib/diff.test.ts
git commit -m "feat: add computeDiff word-level diff utility

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 2: Snapshot pre-edit draft content in the audit log

**Files:**
- Modify: `src/lib/audit-log.ts`
- Modify: `src/app/api/actions/[actionId]/edit/route.ts`
- Modify: `src/app/api/actions/[actionId]/edit/route.test.ts`

**Interfaces:**
- Consumes: `buildAuditLogEntryArgs(customerId, eventType, detail, actionId?)` from Task 2's own change to `audit-log.ts` (unchanged signature — only `AuditEventType` grows a member).
- Produces: the `edit` route's `action_decided` audit entry now always includes `originalDraftContent` in its `detail` JSON when the decision is `edited`. Task 3's `revert` route reads this field back out.

- [ ] **Step 1: Add `action_reverted` to the event type union**

In `src/lib/audit-log.ts`, change:

```typescript
export type AuditEventType = 'action_decided' | 'auto_execute_toggled';
```

to:

```typescript
export type AuditEventType = 'action_decided' | 'action_reverted' | 'auto_execute_toggled';
```

- [ ] **Step 2: Write the failing test for the snapshot**

Add to `src/app/api/actions/[actionId]/edit/route.test.ts`, in the existing `describe` block, after the current passing-case test:

```typescript
  it('records the original draft content in the audit log detail', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
      pageUrl: 'https://example.com/a',
      draftContent: 'Original AI draft.',
    });

    await POST(makeRequest('Edited by the customer.'), { params: { actionId: 'action_1' } });

    const auditCallArgs = (db.auditLogEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(auditCallArgs.data.detail.originalDraftContent).toBe('Original AI draft.');
  });
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/app/api/actions/\[actionId\]/edit/route.test.ts
```

Expected: FAIL — `auditCallArgs.data.detail.originalDraftContent` is `undefined` (the route doesn't pass `draftContent` into the audit detail yet).

- [ ] **Step 4: Update the route**

In `src/app/api/actions/[actionId]/edit/route.ts`, the `db.action.findUnique` call already returns the full action row (no `select` clause), so `action.draftContent` is already in scope. Change the audit log entry build call from:

```typescript
    db.auditLogEntry.create(buildAuditLogEntryArgs(customer.id, 'action_decided', { decision: 'edited', pageUrl: action.pageUrl }, action.id)),
```

to:

```typescript
    db.auditLogEntry.create(
      buildAuditLogEntryArgs(
        customer.id,
        'action_decided',
        { decision: 'edited', pageUrl: action.pageUrl, originalDraftContent: action.draftContent },
        action.id
      )
    ),
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all 150 tests pass (149 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit-log.ts src/app/api/actions/\[actionId\]/edit/route.ts src/app/api/actions/\[actionId\]/edit/route.test.ts
git commit -m "feat: snapshot pre-edit draft content in audit log for rollback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 3: Add the revert route

**Files:**
- Create: `src/app/api/actions/[actionId]/revert/route.ts`
- Create: `src/app/api/actions/[actionId]/revert/route.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `auth` from `@clerk/nextjs/server`, `buildAuditLogEntryArgs` from `@/lib/audit-log` (all three already used identically by `approve/route.ts` and `reject/route.ts` — follow that exact pattern), and the `originalDraftContent` field written into `AuditLogEntry.detail` by Task 2.
- Produces: `POST` handler at `/api/actions/[actionId]/revert` — same signature as the other three decision routes: `POST(req: NextRequest, { params }: { params: { actionId: string } })`. Task 4 (UI) posts a form to this route.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/actions/[actionId]/revert/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { findUnique: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/actions/action_1/revert', { method: 'POST' }) as unknown as NextRequest;
}

const CUSTOMER = { id: 'cust_1', clerkUserId: 'user_1' };

describe('POST /api/actions/[actionId]/revert', () => {
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
      status: 'approved',
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the action is still pending', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'pending',
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('reverts an approved action to pending without touching draftContent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'approved',
      pageUrl: 'https://example.com/a',
      draftContent: 'Live draft.',
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    expect(db.auditLogEntry.findFirst).not.toHaveBeenCalled();
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data).toEqual({ status: 'pending', decidedAt: null });
    const auditArgs = (db.auditLogEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(auditArgs.data.eventType).toBe('action_reverted');
    expect(auditArgs.data.detail.from).toBe('approved');
  });

  it('reverts a rejected action to pending', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'rejected',
      pageUrl: 'https://example.com/a',
      draftContent: 'Live draft.',
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    const auditArgs = (db.auditLogEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(auditArgs.data.detail.from).toBe('rejected');
  });

  it('reverts an edited action and restores the original draft content', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'action_1',
      customerId: 'cust_1',
      status: 'edited',
      pageUrl: 'https://example.com/a',
      draftContent: 'Customer edited this.',
    });
    (db.auditLogEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      detail: { decision: 'edited', originalDraftContent: 'Original AI draft.' },
    });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(307);
    const updateArgs = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.data).toEqual({ status: 'pending', decidedAt: null, draftContent: 'Original AI draft.' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/actions/\[actionId\]/revert/route.test.ts
```

Expected: FAIL — `./route` cannot be found (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/actions/[actionId]/revert/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildAuditLogEntryArgs } from '@/lib/audit-log';

export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId } });
  if (!action || action.customerId !== customer.id || action.status === 'pending') {
    return NextResponse.json({ error: 'Action not found or not yet decided' }, { status: 404 });
  }

  let restoredDraftContent: string | undefined;
  if (action.status === 'edited') {
    const editEntry = await db.auditLogEntry.findFirst({
      where: { actionId: action.id, eventType: 'action_decided' },
      orderBy: { createdAt: 'desc' },
    });
    const detail = editEntry?.detail as { originalDraftContent?: string } | null | undefined;
    restoredDraftContent = detail?.originalDraftContent;
  }

  await db.$transaction([
    db.action.update({
      where: { id: action.id },
      data: {
        status: 'pending',
        decidedAt: null,
        ...(restoredDraftContent !== undefined ? { draftContent: restoredDraftContent } : {}),
      },
    }),
    db.auditLogEntry.create(
      buildAuditLogEntryArgs(customer.id, 'action_reverted', { from: action.status, pageUrl: action.pageUrl }, action.id)
    ),
  ]);

  return NextResponse.redirect(new URL(`/review/${action.id}`, req.url));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/api/actions/\[actionId\]/revert/route.test.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all 156 tests pass (150 from Task 2 + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/actions/\[actionId\]/revert
git commit -m "feat: add revert route to roll back a decided action to pending

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

### Task 4: Surface the diff and a Revert button on the review detail page

**Files:**
- Modify: `src/app/review/[actionId]/page.tsx`

**Interfaces:**
- Consumes: `computeDiff` and `DiffSegment` from `@/lib/diff` (Task 1); posts to `/api/actions/${action.id}/revert` (Task 3).

- [ ] **Step 1: Read the current file's two-card comparison and final-state blocks to match exact structure**

Already read in full during planning (`src/app/review/[actionId]/page.tsx`). The "Current" / "Drafted by Dex" `Card`s sit in a `grid gap-4 sm:grid-cols-2` right after the AI-disclosure banner. The `isFinal` block (approved/edited) and the `action.status === 'rejected'` block sit near the bottom, after the pending-only approve/reject/edit form.

- [ ] **Step 2: Add the diff view below the existing two-card comparison**

Add this import at the top, alongside the other `@/lib` imports:

```typescript
import { computeDiff } from '@/lib/diff';
```

Immediately after the closing `</div>` of the `grid gap-4 sm:grid-cols-2` block (the one containing the "Current" and "Drafted by Dex" `Card`s), add:

```tsx
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">What changes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed" aria-label="Diff between current and drafted content">
          {computeDiff(action.currentValue ?? '', action.draftContent).map((segment, index) => {
            if (segment.type === 'equal') return <span key={index}>{segment.value}</span>;
            if (segment.type === 'added') {
              return (
                <span
                  key={index}
                  className="rounded-sm px-0.5"
                  style={{ backgroundColor: 'var(--dex-app-success-bg)', color: 'var(--dex-app-success)' }}
                >
                  {segment.value}
                </span>
              );
            }
            return (
              <span
                key={index}
                className="rounded-sm px-0.5 line-through"
                style={{ backgroundColor: 'var(--dex-app-danger-bg)', color: 'var(--dex-app-danger)' }}
              >
                {segment.value}
              </span>
            );
          })}
        </CardContent>
      </Card>
```

- [ ] **Step 3: Add a Revert button to the `isFinal` and `rejected` blocks**

Change the `isFinal` block from:

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
          </CardContent>
        </Card>
      )}
```

to:

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

Change the rejected block from:

```tsx
      {action.status === 'rejected' && (
        <p className="mt-6 text-sm text-muted-foreground">You rejected this draft. No changes were applied.</p>
      )}
```

to:

```tsx
      {action.status === 'rejected' && (
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">You rejected this draft. No changes were applied.</p>
          <form action={`/api/actions/${action.id}/revert`} method="post" className="mt-3">
            <Button type="submit" variant="outline" size="sm">
              Undo this decision
            </Button>
          </form>
        </div>
      )}
```

- [ ] **Step 4: Visual verification**

```bash
npm run dev
```

Open `/review/[an existing decided actionId]` in the browser (use the `browse` skill per this project's standing rule, not raw Chrome MCP tools). Confirm:
- Added words render on a green background, removed words render struck-through on a red background, matching `RISK_TIER_VARIANT`'s existing color language.
- "Undo this decision" button appears for approved, edited, and rejected actions, not for pending ones.
- Clicking it returns the action to pending and (for a previously-edited action) restores the original AI draft text in the "Drafted by Dex" card.

- [ ] **Step 5: Run the full test suite one more time, then typecheck**

```bash
npm test
npx tsc --noEmit
```

Expected: all 156 tests pass, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/review/\[actionId\]/page.tsx
git commit -m "feat: show diff and add undo control on review detail page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc"
```

---

## Self-Review

**Spec coverage:** Phase 3 of the assurance-loop-foundation phase table calls for "SafeDeploy: reversible writes (snapshot, diff, rollback)." Scoped to internal-only per founder decision (no live write target exists yet): snapshot → Task 2 (`originalDraftContent` captured in the audit log at edit time), diff → Task 1 + Task 4 (computed and rendered), rollback → Task 3 + Task 4 (revert route + Undo button). All three covered; real external-write rollback deferred to whenever a live write connector exists.

**Placeholder scan:** No TBD/TODO markers. Every step has real code, not a description of code. No test references a function or field not defined by an earlier task in this plan.

**Type consistency:** `DiffSegment` (Task 1) is consumed as-is in Task 4 — same three-member union (`'equal' | 'added' | 'removed'`), same `value: string` field. `AuditEventType` gains `'action_reverted'` in Task 2, used by name in Task 3. The `revert` route's `POST` signature (`req: NextRequest, { params }: { params: { actionId: string } }`) matches `approve`/`reject`/`edit` exactly, so it needs no new type declarations. `originalDraftContent` is written in Task 2's `detail` object and read back with the same key in Task 3 — verified against the actual test assertions above, not just prose.
