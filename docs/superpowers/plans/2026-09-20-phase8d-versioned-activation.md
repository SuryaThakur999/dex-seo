# Phase 8D — Versioned Activation & Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer turn a `passed` Phase 8C evaluation's phrase into an active `ClientProfile.restrictedWording` entry ("Start using"), and reverse that at any later time ("Stop using").

**Architecture:** No schema change to `ClientProfile` — "active" is always derived live by checking whether the evaluation's phrase is currently present in `restrictedWording`, never stored as a separate boolean. `PreferenceEvaluation` gains `activatedAt`/`deactivatedAt` timestamps for audit history only. One new route (`POST /api/preference-candidates/[id]/activation`) handles both directions via an `action` field, mirroring the existing `decide` route's shape and tenant-ownership pattern.

**Tech Stack:** Next.js 14 App Router, Prisma, Vitest, React (client component for the toggle).

## Global Constraints

- Activation is only ever a direct response to an explicit customer click on "Start using" — never automatic, never triggered by evaluation reaching `passed`.
- `restrictedWording` membership is the single source of truth for "is this active." `activatedAt`/`deactivatedAt` are audit-only and must never be read to decide what the UI shows.
- Every write re-derives tenant ownership from the freshly-loaded candidate row (`candidate.clientProfile.customerId !== customer.id`), never trusted from an earlier step in the same request.
- No LLM call anywhere in this feature.
- Every task must leave `npx vitest run`, `npx tsc --noEmit`, and `npx next build` green.

---

### Task 1: Schema — `activatedAt`/`deactivatedAt` on `PreferenceEvaluation`

**Files:**
- Modify: `prisma/schema.prisma:184-209` (the `PreferenceEvaluation` model)
- Create: `prisma/migrations/<timestamp>_add_activation_timestamps/migration.sql` (via `prisma migrate dev`)

**Interfaces:**
- Produces: `PreferenceEvaluation.activatedAt: DateTime | null`, `PreferenceEvaluation.deactivatedAt: DateTime | null`.

- [ ] **Step 1: Add the two fields**

In `prisma/schema.prisma`, find the `PreferenceEvaluation` model (currently ends with `completedAt DateTime?` before the blank line and `cases PreferenceEvaluationCase[]`). Add two lines directly after `completedAt DateTime?`:

```prisma
  completedAt      DateTime?
  activatedAt      DateTime?
  deactivatedAt    DateTime?
```

(Replace only the `completedAt` line and the blank line after it with these three lines — the rest of the model, including `cases PreferenceEvaluationCase[]` and the `@@index`, stays exactly as-is.)

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_activation_timestamps`

**Critical, per this project's own repeated incident:** if this fails with a database connection error, your shell is sandboxed and blocking the Postgres port — run it unsandboxed, or report BLOCKED with that exact diagnosis. Before considering this step done, run `npx prisma migrate status` (env sourced from `.env.local`, unsandboxed: `set -a && source .env.local && set +a && npx prisma migrate status`) and confirm the new migration shows applied, not pending.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add activatedAt/deactivatedAt audit timestamps to PreferenceEvaluation"
```

---

### Task 2: `src/lib/preference-activation.ts` — pure membership functions

**Files:**
- Create: `src/lib/preference-activation.ts`
- Test: `src/lib/preference-activation.test.ts`

**Interfaces:**
- Produces:
  - `export function isPreferenceActive(restrictedWording: string[], phrase: string): boolean`
  - `export function withoutPreference(restrictedWording: string[], phrase: string): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/preference-activation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isPreferenceActive, withoutPreference } from './preference-activation';

describe('isPreferenceActive', () => {
  it('is true when the phrase is present', () => {
    expect(isPreferenceActive(['industry-leading', 'best-in-class'], 'industry-leading')).toBe(true);
  });

  it('is false when the phrase is absent', () => {
    expect(isPreferenceActive(['best-in-class'], 'industry-leading')).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(isPreferenceActive([], 'industry-leading')).toBe(false);
  });
});

describe('withoutPreference', () => {
  it('removes the exact matching phrase', () => {
    expect(withoutPreference(['industry-leading', 'best-in-class'], 'industry-leading')).toEqual(['best-in-class']);
  });

  it('removes every occurrence when the phrase is duplicated', () => {
    expect(withoutPreference(['industry-leading', 'best-in-class', 'industry-leading'], 'industry-leading')).toEqual([
      'best-in-class',
    ]);
  });

  it('is a no-op when the phrase is not present', () => {
    expect(withoutPreference(['best-in-class'], 'industry-leading')).toEqual(['best-in-class']);
  });

  it('does not mutate the input array', () => {
    const input = ['industry-leading'];
    withoutPreference(input, 'industry-leading');
    expect(input).toEqual(['industry-leading']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/preference-activation.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/preference-activation.ts`:

```typescript
// Activation state is never stored -- it's always this membership check against the live
// ClientProfile.restrictedWording array. See docs/superpowers/specs/2026-09-20-phase8d-
// versioned-activation-design.md's "Key decision: activation state is derived, not stored".
export function isPreferenceActive(restrictedWording: string[], phrase: string): boolean {
  return restrictedWording.includes(phrase);
}

// Strips every exact match, not just the first -- duplicates carry no separate meaning
// once membership is the only signal that decides "active."
export function withoutPreference(restrictedWording: string[], phrase: string): string[] {
  return restrictedWording.filter((w) => w !== phrase);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/preference-activation.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/preference-activation.ts src/lib/preference-activation.test.ts
git commit -m "feat: add pure activation-membership functions"
```

---

### Task 3: `POST /api/preference-candidates/[id]/activation`

**Files:**
- Create: `src/app/api/preference-candidates/[id]/activation/route.ts`
- Test: `src/app/api/preference-candidates/[id]/activation/route.test.ts`

**Interfaces:**
- Consumes: `isPreferenceActive`, `withoutPreference` from `@/lib/preference-activation`.
- Produces: `POST` handler at this route. Request body `{ action: 'activate' | 'deactivate' }`. Response `{ isActive: boolean }` on success.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/preference-candidates/[id]/activation/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    preferenceCandidate: { findUnique: vi.fn() },
    clientProfile: { update: vi.fn() },
    preferenceEvaluation: { update: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

function makeRequest(body: object): NextRequest {
  return new Request('http://localhost:3000/api/preference-candidates/cand1/activation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function candidate(overrides: Partial<{
  id: string;
  clientProfileId: string;
  customerId: string;
  restrictedWording: string[];
  evaluation: { id: string; status: string; evaluatedPhrase: string } | null;
}> = {}) {
  return {
    id: 'cand1',
    clientProfileId: 'cp1',
    clientProfile: { id: 'cp1', customerId: overrides.customerId ?? 'cust1', restrictedWording: overrides.restrictedWording ?? [] },
    evaluation: overrides.evaluation === undefined ? { id: 'ev1', status: 'passed', evaluatedPhrase: 'industry-leading' } : overrides.evaluation,
  };
}

describe('POST /api/preference-candidates/[id]/activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid action value', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(candidate());

    const res = await POST(makeRequest({ action: 'not-a-real-action' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the candidate belongs to a different customer', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(candidate({ customerId: 'someone-else' }));

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(404);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the candidate has no evaluation yet', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(candidate({ evaluation: null }));

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(404);
  });

  it('returns 400 when activating an evaluation that has not passed', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ evaluation: { id: 'ev1', status: 'evaluating', evaluatedPhrase: 'industry-leading' } })
    );

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('activates a passed evaluation by pushing the phrase', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['best-in-class'] })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(true);
    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp1' },
      data: { restrictedWording: { push: 'industry-leading' } },
    });
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { activatedAt: expect.any(Date) },
    });
  });

  it('does not push a duplicate when the phrase is already active', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['industry-leading'] })
    );
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(true);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { activatedAt: expect.any(Date) },
    });
  });

  it('deactivates by removing the phrase', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['industry-leading', 'best-in-class'] })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'deactivate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(false);
    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp1' },
      data: { restrictedWording: ['best-in-class'] },
    });
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { deactivatedAt: expect.any(Date) },
    });
  });

  it('deactivating an already-inactive phrase is a no-op write but still succeeds', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['best-in-class'] })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'deactivate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(false);
    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp1' },
      data: { restrictedWording: ['best-in-class'] },
    });
  });

  it('deactivating is allowed even when the evaluation status is not passed', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({
        restrictedWording: ['industry-leading'],
        evaluation: { id: 'ev1', status: 'passed', evaluatedPhrase: 'industry-leading' },
      })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'deactivate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/preference-candidates/\[id\]/activation/route.test.ts`
Expected: FAIL — route module doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/preference-candidates/[id]/activation/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isPreferenceActive, withoutPreference } from '@/lib/preference-activation';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { action } = body as { action: 'activate' | 'deactivate' };

  if (action !== 'activate' && action !== 'deactivate') {
    return NextResponse.json({ error: 'action must be "activate" or "deactivate"' }, { status: 400 });
  }

  const candidate = await db.preferenceCandidate.findUnique({
    where: { id: params.id },
    include: {
      clientProfile: { select: { id: true, customerId: true, restrictedWording: true } },
      evaluation: true,
    },
  });

  if (!candidate || candidate.clientProfile.customerId !== customer.id || !candidate.evaluation) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (action === 'activate' && candidate.evaluation.status !== 'passed') {
    return NextResponse.json({ error: 'This preference has not passed its quality check yet.' }, { status: 400 });
  }

  const phrase = candidate.evaluation.evaluatedPhrase;
  const currentlyActive = isPreferenceActive(candidate.clientProfile.restrictedWording, phrase);

  if (action === 'activate') {
    if (!currentlyActive) {
      // Postgres-native array push is atomic at the database level -- no read-then-write race.
      await db.clientProfile.update({
        where: { id: candidate.clientProfile.id },
        data: { restrictedWording: { push: phrase } },
      });
    }
    await db.preferenceEvaluation.update({ where: { id: candidate.evaluation.id }, data: { activatedAt: new Date() } });
  } else {
    // No atomic "remove array element" for Postgres native arrays -- this is a read-then-write.
    // Accepted risk: a low-frequency, single-actor, explicitly-clicked action, not an automated
    // high-frequency path. See the design doc's "New route" section.
    await db.clientProfile.update({
      where: { id: candidate.clientProfile.id },
      data: { restrictedWording: withoutPreference(candidate.clientProfile.restrictedWording, phrase) },
    });
    await db.preferenceEvaluation.update({ where: { id: candidate.evaluation.id }, data: { deactivatedAt: new Date() } });
  }

  return NextResponse.json({ isActive: action === 'activate' });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/preference-candidates/\[id\]/activation/route.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/preference-candidates/\[id\]/activation
git commit -m "feat: add activation route for passed preference evaluations"
```

---

### Task 4: `ActivationToggle` client component

**Files:**
- Create: `src/components/settings/activation-toggle.tsx`
- Test: `src/components/settings/activation-toggle.test.tsx`

**Interfaces:**
- Produces: `export function ActivationToggle({ candidateId, initialActive }: { candidateId: string; initialActive: boolean })`

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/activation-toggle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActivationToggle } from './activation-toggle';

describe('ActivationToggle', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('shows "Start using" when inactive and posts activate on click', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ isActive: true }) });
    render(<ActivationToggle candidateId="cand1" initialActive={false} />);

    fireEvent.click(screen.getByText('Start using'));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/preference-candidates/cand1/activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate' }),
    }));
    await waitFor(() => expect(screen.getByText('Active — Stop using')).toBeTruthy());
  });

  it('shows "Active — Stop using" when active and posts deactivate on click', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ isActive: false }) });
    render(<ActivationToggle candidateId="cand1" initialActive={true} />);

    fireEvent.click(screen.getByText('Active — Stop using'));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/preference-candidates/cand1/activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deactivate' }),
    }));
    await waitFor(() => expect(screen.getByText('Start using')).toBeTruthy());
  });

  it('shows an error and keeps the prior state when the request fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    render(<ActivationToggle candidateId="cand1" initialActive={false} />);

    fireEvent.click(screen.getByText('Start using'));

    await waitFor(() => expect(screen.getByText('Could not update this preference. Try again.')).toBeTruthy());
    expect(screen.getByText('Start using')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/settings/activation-toggle.test.tsx`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/components/settings/activation-toggle.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function ActivationToggle({ candidateId, initialActive }: { candidateId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const action = active ? 'deactivate' : 'activate';
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/preference-candidates/${candidateId}/activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setError('Could not update this preference. Try again.');
        return;
      }
      const body = await res.json();
      setActive(body.isActive);
    } catch {
      setError('Could not update this preference. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant={active ? 'outline' : 'accent'} onClick={handleClick} disabled={pending}>
        {active ? 'Active — Stop using' : 'Start using'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/settings/activation-toggle.test.tsx`
Expected: PASS, all 3 tests. If `@testing-library/react` isn't already a dependency, check `package.json` first — this codebase's other component tests (e.g. `src/components/dashboard/seo-findings-panel.test.tsx`) already use it, so it should already be installed; if the import fails, run `grep '"@testing-library/react"' package.json` to confirm before adding anything.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/activation-toggle.tsx src/components/settings/activation-toggle.test.tsx
git commit -m "feat: add ActivationToggle component"
```

---

### Task 5: Wire into Settings — query, `isActive` computation, `LearningSection` render

**Files:**
- Modify: `src/app/settings/page.tsx`
- Modify: `src/components/settings/learning-section.tsx`
- Modify: `src/components/settings/learning-section.test.tsx`

**Interfaces:**
- Modifies `LearningSection`'s `CandidateRow` to add `evaluatedPhrase: string | null` and `isActive: boolean`.

- [ ] **Step 1: Extend the Settings query and pass `isActive`/`evaluatedPhrase` down**

In `src/app/settings/page.tsx`, change the `candidates` query's `select` block from:

```typescript
        select: { id: true, originalProposedPhrase: true, customerEditedPhrase: true, status: true, generatedAt: true, website: { select: { url: true } }, evaluation: { select: { status: true } } },
```

to:

```typescript
        select: { id: true, originalProposedPhrase: true, customerEditedPhrase: true, status: true, generatedAt: true, website: { select: { url: true } }, evaluation: { select: { status: true, evaluatedPhrase: true } } },
```

Then change the `<LearningSection>` call from:

```tsx
      <LearningSection
        candidates={candidates.map((c) => ({ ...c, websiteUrl: c.website.url, evaluationStatus: c.evaluation?.status ?? null }))}
      />
```

to:

```tsx
      <LearningSection
        candidates={candidates.map((c) => ({
          ...c,
          websiteUrl: c.website.url,
          evaluationStatus: c.evaluation?.status ?? null,
          evaluatedPhrase: c.evaluation?.evaluatedPhrase ?? null,
          isActive: c.evaluation ? clientProfile!.restrictedWording.includes(c.evaluation.evaluatedPhrase) : false,
        }))}
      />
```

(`clientProfile!` is safe here — `candidates` is only ever non-empty when `clientProfile` was truthy, per the ternary a few lines above that populates it.)

- [ ] **Step 2: Render `ActivationToggle` for passed rows in `LearningSection`**

In `src/components/settings/learning-section.tsx`, add the import:

```typescript
import { ActivationToggle } from './activation-toggle';
```

Change the `CandidateRow` interface from:

```typescript
export interface CandidateRow {
  id: string;
  originalProposedPhrase: string;
  customerEditedPhrase: string | null;
  status: string;
  generatedAt: Date;
  websiteUrl: string;
  evaluationStatus: string | null;
}
```

to:

```typescript
export interface CandidateRow {
  id: string;
  originalProposedPhrase: string;
  customerEditedPhrase: string | null;
  status: string;
  generatedAt: Date;
  websiteUrl: string;
  evaluationStatus: string | null;
  evaluatedPhrase: string | null;
  isActive: boolean;
}
```

Change the row's status span from:

```tsx
                <span className="text-xs text-muted-foreground">
                  {c.status === 'approved_for_evaluation' && c.evaluationStatus
                    ? formatEvaluationStatusLabel(c.evaluationStatus)
                    : formatCandidateStatusLabel(c.status)}
                </span>
```

to:

```tsx
                {c.status === 'approved_for_evaluation' && c.evaluationStatus === 'passed' ? (
                  <ActivationToggle candidateId={c.id} initialActive={c.isActive} />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {c.status === 'approved_for_evaluation' && c.evaluationStatus
                      ? formatEvaluationStatusLabel(c.evaluationStatus)
                      : formatCandidateStatusLabel(c.status)}
                  </span>
                )}
```

- [ ] **Step 3: Update the existing Learning section test**

`learning-section.test.tsx` only tests the pure `formatCandidateStatusLabel`/`formatEvaluationStatusLabel` functions, unaffected by this change — confirm it still passes unmodified. If any test constructs a `CandidateRow` object literal, add `evaluatedPhrase: null` and `isActive: false` to it so it still type-checks.

- [ ] **Step 4: Run the full check**

Run: `npx vitest run` — expect all passing.
Run: `npx tsc --noEmit` — expect clean.
Run: `npx next build` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/page.tsx src/components/settings/learning-section.tsx src/components/settings/learning-section.test.tsx
git commit -m "feat: show Start using/Stop using toggle for passed preferences"
```

---

### Task 6: Full regression, browser verification, independent review, and deploy

**Files:** none (verification + deployment only)

- [ ] **Step 1: Full verification**

Run in order: `npx vitest run`, `npx tsc --noEmit`, `npx next build`. All must pass. Restart any live local dev server afterward.

- [ ] **Step 2: Migration integrity, outside the sandbox**

Run (env sourced, unsandboxed): `npx prisma migrate status` — confirm the new migration shows applied, zero pending.

- [ ] **Step 3: Visual verification on real data, with controlled fixtures where production data doesn't naturally contain the states**

Using the project's `browse` skill against an authenticated session: as of this plan's writing, no account in the fleet has a `passed` evaluation (per Phase 8C's own honest completion note), so this will very likely need a manually-created test row in a dev database, not production, to see the toggle render at all. If production genuinely has no `passed` row to exercise, say so honestly rather than fabricating a production pass result — the toggle's activate/deactivate behavior is already fully covered by Task 3's and Task 4's unit/component tests. If a real or fixture `passed` row is available: confirm clicking "Start using" adds the phrase to `restrictedWording` (visible in the Brand Preferences textarea after a reload) and flips the button to "Active — Stop using"; confirm clicking it again removes the phrase and flips back; confirm the toggle survives a manual edit to the Brand Preferences textarea that removes the phrase by hand (page reload should show "Start using" again, not stale "Active"). Test desktop and 375px mobile layouts.

- [ ] **Step 4: Independent review**

Dispatch a fresh subagent (no shared context) as an independent reviewer, checking specifically: can the activation route be called for a candidate/evaluation belonging to a different customer (trace the ownership check end to end)? Can "activate" ever succeed when `evaluation.status !== 'passed'`? Does "deactivate" correctly remove every occurrence of the phrase, not just one, when duplicates exist? Does anything in this diff write to `restrictedWording` outside the two `db.clientProfile.update` calls in the activation route? Report findings; fix all Critical/Important findings in one consolidated pass before deploying; record Minor findings honestly.

- [ ] **Step 5: Deploy**

```bash
npx prisma migrate deploy
vercel deploy --prod --yes
```

Confirm the alias: `vercel inspect dex-ai-plum.vercel.app` — printed `id` must match the deployment just created.

- [ ] **Step 6: Record completion**

Append a section to `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md`, matching this session's established per-slice entries: what shipped, commit SHAs, deployment id, and this accurate completion statement:

> Phase 8D shipped: a customer can turn a passed quality-check evaluation into an active restricted-wording entry with one click, and reverse it at any later time. Activation state is always derived live from ClientProfile.restrictedWording, never a separate stored flag, so a manual Brand Preferences edit can never leave the toggle showing a stale state. This closes the full Milestone E controlled-learning pipeline: candidate → evaluate → activate/roll back.

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "docs: record Phase 8D versioned activation completion"
```

---

## Self-Review Notes

- **Spec coverage:** the design doc's "Key decision" (membership-derived state, Task 1+2), "New route" (Task 3), "UI" (Task 4+5), and "Testing" section are all covered by a task each. The design doc's "Explicitly out of scope" items (bulk actions, history view, race-hardening the deactivate write) are correctly absent from every task.
- **Placeholder scan:** none found. Task 6 Step 3's "may need a fixture" language mirrors Phase 8C's own Task 7 Step 3 honesty pattern, not a placeholder — it's an explicit instruction to verify against real state rather than assume.
- **Type consistency:** `CandidateRow`'s new `evaluatedPhrase`/`isActive` fields (Task 5) match exactly how they're populated in `settings/page.tsx`'s mapping (Task 5, same task) and consumed by `ActivationToggle`'s props (Task 4, `candidateId`/`initialActive` — note the prop name `initialActive` intentionally differs from `CandidateRow.isActive` since one is the row's live-computed value and the other is the component's own internal state seed, matching the existing `AutoExecuteToggle`'s `initialEnabled` naming convention). `isPreferenceActive`/`withoutPreference` (Task 2) used with identical signatures in the route (Task 3).
