# Phase 8C — Automatic Preference Quality Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate `approved_for_evaluation` candidates automatically in shadow mode, using independent customer evidence from future decided drafts, and close four real risks from Phase 8B's final review before adding new scope.

**Architecture:** Two new tables (`PreferenceEvaluation`, `PreferenceEvaluationCase`) track an evaluation per candidate and one case per independent decided action. Three existing decision routes (approve/reject/edit) get a small, non-blocking, idempotent hook that classifies the action against any in-progress evaluation for that website and records a case. All classification and threshold logic is deterministic — no LLM. Nothing in this feature ever writes to `ClientProfile`.

**Tech Stack:** Next.js 14 App Router, Prisma, Vitest, the existing `phraseAppearsIn` word-boundary matcher from Phase 8B.

## Global Constraints

- Evaluation never blocks, modifies, or delays a draft; never writes `ClientProfile.restrictedWording`; never touches `proof-layer.ts`; never requires a customer action; never calls an LLM for classification; never describes anything as "learned," "active," or "applied."
- Independent evidence only: an action whose ID appears in the candidate's own `evidenceEntryIds` is excluded, never counted.
- `MIN_INDEPENDENT_CASES = 3`. Any `counter_evidence` count `> 0` at or past that floor is `failed`, never averaged away.
- Event handlers in approve/reject/edit routes must stay fast (a handful of indexed queries, no network call beyond the database) and must never throw in a way that blocks the route's own existing response.
- No new nav item, no badge, no fingerprint/model/prompt/version terminology in customer-facing copy, no fabricated progress percentage.
- Cross-tenant isolation on every new write: re-derive ownership from the actual `Action`/`Website`/`ClientProfile` chain immediately before writing, not trusted from an earlier step.
- Every task must leave `npx vitest run`, `npx tsc --noEmit`, and `npx next build` green.

---

### Task 1: Schema — `PreferenceEvaluation` + `PreferenceEvaluationCase`, plus the two design-doc wording fixes

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `docs/superpowers/specs/2026-09-20-phase8b-suggested-preferences-design.md`
- Create: `prisma/migrations/<timestamp>_add_preference_evaluations/migration.sql` (via `prisma migrate dev`)

**Interfaces:**
- Produces: `PreferenceEvaluation` and `PreferenceEvaluationCase` Prisma models.

- [ ] **Step 1: Add both models**

Add to `prisma/schema.prisma`, after the existing `PreferenceCandidateCheck` model:

```prisma
model PreferenceEvaluation {
  id               String    @id @default(cuid())
  candidateId      String    @unique
  candidate        PreferenceCandidate @relation(fields: [candidateId], references: [id])
  clientProfileId  String
  clientProfile    ClientProfile @relation(fields: [clientProfileId], references: [id])
  websiteId        String
  website          Website   @relation(fields: [websiteId], references: [id])
  targetField      String
  evaluatedPhrase  String
  excludedActionIds String[]
  supportingCount  Int       @default(0)
  counterCount     Int       @default(0)
  neutralCount     Int       @default(0)
  status           String
  decisionRationale String?
  evaluatorVersion String
  sourceFingerprint String?
  limitations      String?
  startedAt        DateTime  @default(now())
  completedAt      DateTime?

  cases PreferenceEvaluationCase[]

  @@index([websiteId, status])
}

model PreferenceEvaluationCase {
  id             String   @id @default(cuid())
  evaluationId   String
  evaluation     PreferenceEvaluation @relation(fields: [evaluationId], references: [id])
  actionId       String
  classification String
  evidenceExcerpt Json?
  createdAt      DateTime @default(now())

  @@unique([evaluationId, actionId])
  @@index([actionId])
}
```

Add back-relation fields. In `PreferenceCandidate`, add `evaluation PreferenceEvaluation?` after `decidedAt`. In `ClientProfile`, add `preferenceEvaluations PreferenceEvaluation[]` next to the other `preferenceCandidate*` back-relations. In `Website`, add `preferenceEvaluations PreferenceEvaluation[]` next to its `preferenceCandidate*` back-relations.

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_preference_evaluations`

**Critical, per this project's own repeated incident:** if this fails with a database connection error, your shell is sandboxed and blocking the Postgres port — run it unsandboxed, or report BLOCKED with that exact diagnosis. Before considering this step done, run `npx prisma migrate status` (env sourced from `.env.local`, unsandboxed: `set -a && source .env.local && set +a && npx prisma migrate status`) and confirm the new migration shows applied, not pending.

- [ ] **Step 3: Fix the two Phase 8B design-doc wording mismatches**

In `docs/superpowers/specs/2026-09-20-phase8b-suggested-preferences-design.md`, find the deterministic verification gate's condition 4 text (about tenant re-verification) and replace it with: "Every piece of supporting evidence comes from queries built from `websiteId`/`clientProfileId` values that themselves came from `resolveWebsiteForRequest` — cross-tenant data cannot enter the eligible-edits set. This is scoping correctness, not a separate verification step."

Find the "Data retention" paragraph's "no restrict-cascade" sentence and replace it with: "Foreign keys use `ON DELETE RESTRICT`, matching this schema's existing convention throughout — deletion isn't blocked by this feature specifically, it's blocked the same way every other customer-data relation in this schema already is."

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/superpowers/specs/2026-09-20-phase8b-suggested-preferences-design.md
git commit -m "feat: add PreferenceEvaluation schema, fix Phase 8B doc wording"
```

---

### Task 2: TOCTOU fix — atomic claim on the check route

**Files:**
- Modify: `src/app/api/websites/[id]/preference-candidates/check/route.ts`
- Modify: `src/app/api/websites/[id]/preference-candidates/check/route.test.ts`

**Interfaces:**
- No new exports — internal restructuring of the existing route handler's control flow.

- [ ] **Step 1: Write the failing test**

Add to the existing test file (after the existing "returns the stored outcome without a new LLM call when the fingerprint is unchanged" test):

```typescript
  it('loses the claim gracefully when another request already claimed this exact fingerprint (P2002 on create)', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const actions = ['a1', 'a2', 'a3', 'a4', 'a5'].map(editedAction);
    const entries = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    // No existing row (updateMany matches nothing) and the create attempt collides -- another
    // request won the race between our updateMany and our create.
    (db.preferenceCandidateCheck.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const { Prisma } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
    (db.preferenceCandidateCheck.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    );
    (db.preferenceCandidateCheck.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ lastOutcome: 'candidate_created' });

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('candidate_created');
    expect(proposeCandidate).not.toHaveBeenCalled();
  });

  it('wins the claim via updateMany when a row already exists with a different fingerprint', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const actions = ids.map(editedAction);
    const entries = ids.map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (db.preferenceCandidateCheck.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [] });
    (db.preferenceCandidate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (proposeCandidate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.preferenceCandidateCheck.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('no_pattern');
    expect(db.preferenceCandidateCheck.create).not.toHaveBeenCalled();
    expect(db.preferenceCandidateCheck.update).toHaveBeenCalledTimes(1);
  });
```

Add `updateMany` and `update` (separate from the existing `upsert`, which this task removes) to the `db.preferenceCandidateCheck` mock at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/websites/\[id\]/preference-candidates/check/route.test.ts`
Expected: FAIL — `updateMany`/`update` don't exist on the route's DB calls yet (still uses `findUnique`+`upsert`).

- [ ] **Step 3: Rewrite the claim logic**

In `src/app/api/websites/[id]/preference-candidates/check/route.ts`, add `import { Prisma } from '@prisma/client';` to the imports, and replace the block from `const lastCheck = await db.preferenceCandidateCheck.findUnique(...)` through the final `await db.preferenceCandidateCheck.upsert(...)` call with:

```typescript
  const checkWhere = { websiteId: website.id, clientProfileId: website.clientProfileId, targetField: TARGET_FIELD };

  // Atomic claim: an UPDATE only matches (and only one concurrent request can win it) when the
  // stored fingerprint differs from the live one -- Postgres serializes concurrent UPDATEs on
  // the same row. If nothing matched, either no row exists yet or another request just won this
  // exact claim; try CREATE next, and if that also loses (P2002, another request beat us to the
  // first-ever row), re-read and return whatever the winner recorded. This closes the TOCTOU
  // window between "is this fingerprint new" and "record that we're handling it" with no new
  // table and no advisory lock -- just the row's own uniqueness as the lock.
  const claimed = await db.preferenceCandidateCheck.updateMany({
    where: { ...checkWhere, lastFingerprint: { not: fingerprint } },
    data: { lastFingerprint: fingerprint, lastOutcome: 'pending', checkedAt: new Date() },
  });

  let wonClaim = claimed.count === 1;
  if (!wonClaim) {
    try {
      await db.preferenceCandidateCheck.create({
        data: { ...checkWhere, lastFingerprint: fingerprint, lastOutcome: 'pending', lastCandidateId: null },
      });
      wonClaim = true;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }

  if (!wonClaim) {
    const current = await db.preferenceCandidateCheck.findUnique({ where: { websiteId_clientProfileId_targetField: checkWhere } });
    return NextResponse.json({ outcome: current?.lastOutcome ?? 'no_pattern' });
  }

  const clientProfile = await db.clientProfile.findUnique({
    where: { id: website.clientProfileId },
    select: { restrictedWording: true },
  });

  const existingCandidates = await db.preferenceCandidate.findMany({
    where: { websiteId: website.id, clientProfileId: website.clientProfileId, targetField: TARGET_FIELD, status: { in: ['proposed', 'approved_for_evaluation', 'rejected'] } },
    select: { id: true, originalProposedPhrase: true, customerEditedPhrase: true, status: true },
  });
  const existingPhrases = existingCandidates.map((c) => c.customerEditedPhrase ?? c.originalProposedPhrase);

  const proposal = await proposeCandidate(eligibleEdits);

  let outcome: 'candidate_created' | 'no_pattern' = 'no_pattern';
  let createdCandidate: { id: string; originalProposedPhrase: string; rationale: string; evidenceExcerpts: unknown } | null = null;

  if (proposal) {
    const verification = verifyCandidatePhrase(proposal.phrase, eligibleEdits, existingPhrases, clientProfile?.restrictedWording ?? []);
    if (verification.valid) {
      const supportingEdits = eligibleEdits.filter((e) => verification.supportingEditIds.includes(e.auditLogEntryId));
      const priorProposed = existingCandidates.find((c) => c.status === 'proposed');

      createdCandidate = await db.preferenceCandidate.create({
        data: {
          clientProfileId: website.clientProfileId,
          websiteId: website.id,
          targetField: TARGET_FIELD,
          originalProposedPhrase: proposal.phrase,
          rationale: proposal.rationale,
          evidenceEntryIds: verification.supportingEditIds,
          evidenceExcerpts: supportingEdits.map((e) => ({ auditLogEntryId: e.auditLogEntryId, before: e.before, after: e.after })),
          status: 'proposed',
          sourceFingerprint: fingerprint,
          modelVersion: CANDIDATE_MODEL,
          promptVersion: CANDIDATE_PROMPT_VERSION,
        },
      });

      if (priorProposed) {
        await db.preferenceCandidate.update({
          where: { id: priorProposed.id },
          data: { status: 'superseded', supersededById: createdCandidate.id, decidedAt: new Date() },
        });
      }

      outcome = 'candidate_created';
    }
  }

  await db.preferenceCandidateCheck.update({
    where: { websiteId_clientProfileId_targetField: checkWhere },
    data: { lastOutcome: outcome, lastCandidateId: createdCandidate?.id ?? null },
  });
```

The final `return NextResponse.json({ outcome, ...})` block at the end of the function stays exactly as it was — only the claim/dedup logic above it changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/websites/\[id\]/preference-candidates/check/route.test.ts`
Expected: PASS, all tests (the 2 new plus all existing ones — the existing "unchanged fingerprint" test must still pass, since `updateMany` with `lastFingerprint: { not: fingerprint }` correctly matches 0 rows when the fingerprint IS unchanged, falls through to the `create` attempt, which then fails with P2002 since a row already exists, correctly returning the stored outcome).

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/websites/\[id\]/preference-candidates/check
git commit -m "fix: close TOCTOU race in preference-candidates check route with an atomic claim"
```

---

### Task 3: Website attribution in Review card and Settings Learning section

**Files:**
- Modify: `src/app/review/page.tsx`
- Modify: `src/components/review/preference-suggestion-card.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/components/settings/learning-section.tsx`
- Modify: `src/components/settings/learning-section.test.tsx`

**Interfaces:**
- Modifies existing `Candidate`/`CandidateRow` shapes to add `websiteUrl: string`.

- [ ] **Step 1: Update the Review page query and card prop**

In `src/app/review/page.tsx`, find the `existingProposed` query's `select` block and add `website: { select: { url: true } }` to it. In the JSX where `initialCandidate` is built, add `websiteUrl: existingProposed.website.url,` to the object.

In `src/components/review/preference-suggestion-card.tsx`, add `websiteUrl: string;` to the `Candidate` interface. In the rendered card, add a line showing the site right under the main copy line — e.g. `<p className="text-xs text-muted-foreground">On {candidate.websiteUrl}</p>` placed right after the `formatSuggestionCopy` paragraph.

- [ ] **Step 2: Update the Settings query and Learning section**

In `src/app/settings/page.tsx`, find the `candidates` query's `select` block and add `website: { select: { url: true } }`.

In `src/components/settings/learning-section.tsx`, add `websiteUrl: string;` to the `CandidateRow` interface, and render it inline — change the row's phrase line to show the site, e.g.:

```tsx
              <div key={c.id} className="flex items-center justify-between gap-4 rounded-md border border-border p-3 text-sm">
                <div className="min-w-0">
                  <span className="text-foreground">&quot;{c.customerEditedPhrase ?? c.originalProposedPhrase}&quot;</span>
                  <p className="text-xs text-muted-foreground">{c.websiteUrl}</p>
                </div>
                <span className="text-xs text-muted-foreground">{formatCandidateStatusLabel(c.status)}</span>
              </div>
```

- [ ] **Step 3: Update the existing Learning section test**

The existing `learning-section.test.tsx` only tests the pure `formatCandidateStatusLabel` function, which is unaffected by this change — confirm it still passes unmodified. If any test constructs a `CandidateRow` object literal, add `websiteUrl: 'example.com'` to it so it still type-checks.

- [ ] **Step 4: Run the full check**

Run: `npx vitest run` — expect all passing.
Run: `npx tsc --noEmit` — expect clean.
Run: `npx next build` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/review/page.tsx src/components/review/preference-suggestion-card.tsx src/app/settings/page.tsx src/components/settings/learning-section.tsx src/components/settings/learning-section.test.tsx
git commit -m "feat: show website attribution on suggested-preference surfaces"
```

---

### Task 4: Deterministic classification + threshold library

**Files:**
- Create: `src/lib/preference-evaluation.ts`
- Test: `src/lib/preference-evaluation.test.ts`

**Interfaces:**
- Consumes: `phraseAppearsIn` from `@/lib/preference-candidates` (already built in Phase 8B — do not reimplement).
- Produces:
  - `export const MIN_INDEPENDENT_CASES = 3`
  - `export const EVALUATOR_VERSION = 'v1'`
  - `export type EvaluationCaseClassification = 'supporting' | 'counter_evidence' | 'neutral' | 'invalid'`
  - `export interface DecidedActionForEvaluation { actionId: string; decision: 'approved' | 'rejected' | 'edited'; draftContent: string; originalDraftContent?: string }` — `originalDraftContent` is only present for `edited` decisions (the pre-edit text).
  - `export function classifyEvaluationCase(action: DecidedActionForEvaluation, phrase: string, excludedActionIds: string[]): EvaluationCaseClassification` — implements exactly the per-event-type rules from the design doc: `invalid` if `action.actionId` is in `excludedActionIds`; `rejected` → always `neutral`; `approved` → `counter_evidence` if `phraseAppearsIn(phrase, action.draftContent)` else `neutral`; `edited` → if `originalDraftContent` is missing, `neutral` (defensive — shouldn't happen for a real edited action, but never crash); else if phrase absent from `originalDraftContent`, `neutral`; else if phrase absent from `draftContent` (removed), `supporting`; else (still present), `counter_evidence`.
  - `export interface EvaluationCounts { supportingCount: number; counterCount: number; neutralCount: number }`
  - `export type EvaluationStatus = 'pending' | 'evaluating' | 'passed' | 'failed' | 'insufficient_evidence'`
  - `export function decideEvaluationStatus(counts: EvaluationCounts): EvaluationStatus` — implements the threshold rule: `supportingCount + counterCount < MIN_INDEPENDENT_CASES` → `'insufficient_evidence'`; else `counterCount > 0` → `'failed'`; else → `'passed'`. (A caller decides `'pending'` vs `'evaluating'` itself, based on whether any case exists yet — this function only ever returns one of the three resolved terminal-or-insufficient states, since it's only called once at least one case exists.)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/preference-evaluation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyEvaluationCase, decideEvaluationStatus, MIN_INDEPENDENT_CASES } from './preference-evaluation';

describe('classifyEvaluationCase', () => {
  const phrase = 'industry-leading';

  it('classifies a rejected action as neutral regardless of phrase presence', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'rejected', draftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an approved action containing the phrase as counter_evidence', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'approved', draftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('counter_evidence');
  });

  it('classifies an approved action without the phrase as neutral', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'approved', draftContent: 'Our solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an edited action that removed the phrase as supporting', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our solution.', originalDraftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('supporting');
  });

  it('classifies an edited action that kept the phrase as counter_evidence', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our industry-leading solution, updated.', originalDraftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('counter_evidence');
  });

  it('classifies an edited action whose original text never had the phrase as neutral', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our updated solution.', originalDraftContent: 'Our solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an edited action missing originalDraftContent as neutral, never throws', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an excluded (inference-source) action as invalid regardless of content', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our solution.', originalDraftContent: 'Our industry-leading solution.' },
      phrase,
      ['a1']
    );
    expect(result).toBe('invalid');
  });
});

describe('decideEvaluationStatus', () => {
  it('is insufficient_evidence below MIN_INDEPENDENT_CASES total', () => {
    expect(decideEvaluationStatus({ supportingCount: 2, counterCount: 0, neutralCount: 5 })).toBe('insufficient_evidence');
  });

  it('is passed at the threshold with zero counter-evidence', () => {
    expect(decideEvaluationStatus({ supportingCount: MIN_INDEPENDENT_CASES, counterCount: 0, neutralCount: 0 })).toBe('passed');
  });

  it('is failed when any counter-evidence exists, even with strong supporting evidence', () => {
    expect(decideEvaluationStatus({ supportingCount: 10, counterCount: 1, neutralCount: 0 })).toBe('failed');
  });

  it('is insufficient_evidence when counter-evidence exists but total is still below the floor', () => {
    expect(decideEvaluationStatus({ supportingCount: 1, counterCount: 1, neutralCount: 0 })).toBe('insufficient_evidence');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/preference-evaluation.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/preference-evaluation.ts`:

```typescript
import { phraseAppearsIn } from './preference-candidates';

export const MIN_INDEPENDENT_CASES = 3;
export const EVALUATOR_VERSION = 'v1';

export type EvaluationCaseClassification = 'supporting' | 'counter_evidence' | 'neutral' | 'invalid';

export interface DecidedActionForEvaluation {
  actionId: string;
  decision: 'approved' | 'rejected' | 'edited';
  draftContent: string;
  originalDraftContent?: string;
}

// Deterministic per-event-type classification -- see design doc's "Independent evidence" section
// for the reasoning behind each branch. Never calls an LLM; a case is either real evidence
// (supporting/counter_evidence) or it isn't (neutral/invalid) -- there is no probabilistic middle.
export function classifyEvaluationCase(
  action: DecidedActionForEvaluation,
  phrase: string,
  excludedActionIds: string[]
): EvaluationCaseClassification {
  if (excludedActionIds.includes(action.actionId)) return 'invalid';

  if (action.decision === 'rejected') return 'neutral';

  if (action.decision === 'approved') {
    return phraseAppearsIn(phrase, action.draftContent) ? 'counter_evidence' : 'neutral';
  }

  // edited
  if (!action.originalDraftContent) return 'neutral';
  if (!phraseAppearsIn(phrase, action.originalDraftContent)) return 'neutral';
  return phraseAppearsIn(phrase, action.draftContent) ? 'counter_evidence' : 'supporting';
}

export interface EvaluationCounts {
  supportingCount: number;
  counterCount: number;
  neutralCount: number;
}

export type EvaluationStatus = 'pending' | 'evaluating' | 'passed' | 'failed' | 'insufficient_evidence';

// Conservative by design: any real counter-evidence blocks a pass outright, since
// restrictedWording is a blanket customer-wide rule -- one confirmed exception is a real
// contradiction, not noise. See design doc's "Evaluation threshold, defined and justified".
export function decideEvaluationStatus(counts: EvaluationCounts): EvaluationStatus {
  const total = counts.supportingCount + counts.counterCount;
  if (total < MIN_INDEPENDENT_CASES) return 'insufficient_evidence';
  if (counts.counterCount > 0) return 'failed';
  return 'passed';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/preference-evaluation.test.ts`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/preference-evaluation.ts src/lib/preference-evaluation.test.ts
git commit -m "feat: add deterministic evaluation-case classification and threshold logic"
```

---

### Task 5: Event integration — evaluation creation and case recording

**Files:**
- Modify: `src/app/api/preference-candidates/[id]/decide/route.ts`
- Modify: `src/app/api/preference-candidates/[id]/decide/route.test.ts`
- Create: `src/lib/preference-evaluation-events.ts`
- Test: `src/lib/preference-evaluation-events.test.ts`
- Modify: `src/app/api/actions/[actionId]/approve/route.ts`
- Modify: `src/app/api/actions/[actionId]/reject/route.ts`
- Modify: `src/app/api/actions/[actionId]/edit/route.ts`
- Modify: their corresponding `.test.ts` files

**Interfaces:**
- Consumes: `classifyEvaluationCase`, `decideEvaluationStatus`, `EVALUATOR_VERSION`, `DecidedActionForEvaluation` from `@/lib/preference-evaluation`; `Prisma` from `@prisma/client` (for the P2002 catch, same pattern as Task 2).
- Produces: `export async function recordEvaluationCase(websiteId: string, action: DecidedActionForEvaluation): Promise<void>` — the shared event handler all three decision routes call. Looks up `PreferenceEvaluation` rows for `websiteId` with `status IN ('pending', 'evaluating')`, classifies the action against each, attempts to insert a `PreferenceEvaluationCase` (catching `P2002` as an already-processed no-op — this is the idempotency guarantee), and on a successful insert updates the parent `PreferenceEvaluation`'s counts and re-runs `decideEvaluationStatus`, setting `status` to `'evaluating'` on the first case and to the resolved status once the threshold logic no longer returns `'insufficient_evidence'` while cases keep arriving unresolved (`'insufficient_evidence'` itself is NOT a terminal status the evaluation gets stuck in forever — a later case can still move it to `'passed'`/`'failed'`, so only set `completedAt` when the status becomes `'passed'` or `'failed'`). Never throws — the caller (a decision route) must not have its own response blocked by an evaluation-recording failure; catch, log via `console.error`, and return.

- [ ] **Step 1: Write the failing tests for `recordEvaluationCase`**

Create `src/lib/preference-evaluation-events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordEvaluationCase } from './preference-evaluation-events';
import { db } from './db';

vi.mock('./db', () => ({
  db: {
    preferenceEvaluation: { findMany: vi.fn(), update: vi.fn() },
    preferenceEvaluationCase: { create: vi.fn() },
  },
}));

function evaluation(overrides: Partial<{ id: string; evaluatedPhrase: string; excludedActionIds: string[]; supportingCount: number; counterCount: number; neutralCount: number; status: string }> = {}) {
  return {
    id: 'ev1',
    evaluatedPhrase: 'industry-leading',
    excludedActionIds: [],
    supportingCount: 0,
    counterCount: 0,
    neutralCount: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('recordEvaluationCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no in-progress evaluation exists for this website', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await recordEvaluationCase('w1', { actionId: 'a1', decision: 'approved', draftContent: 'text' });

    expect(db.preferenceEvaluationCase.create).not.toHaveBeenCalled();
  });

  it('records a supporting case and updates counts/status', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([evaluation({ supportingCount: 2 })]);
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    expect(db.preferenceEvaluationCase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evaluationId: 'ev1', actionId: 'a1', classification: 'supporting' }) })
    );
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ev1' },
        data: expect.objectContaining({ supportingCount: 3, status: 'passed', completedAt: expect.any(Date) }),
      })
    );
  });

  it('is idempotent -- a duplicate case (P2002) does not double-count', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([evaluation({ supportingCount: 5 })]);
    const { Prisma } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    );

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    expect(db.preferenceEvaluation.update).not.toHaveBeenCalled();
  });

  it('excludes an action in excludedActionIds -- records it as invalid, never counts it', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([evaluation({ excludedActionIds: ['a1'] })]);
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    const updateCall = (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateCall.data.supportingCount).toBeUndefined();
    expect(updateCall.data.status).toBe('evaluating');
  });

  it('never throws -- a DB failure is caught and swallowed, not surfaced to the caller', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection lost'));

    await expect(recordEvaluationCase('w1', { actionId: 'a1', decision: 'approved', draftContent: 'text' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/preference-evaluation-events.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `recordEvaluationCase`**

Create `src/lib/preference-evaluation-events.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { db } from './db';
import { classifyEvaluationCase, decideEvaluationStatus, type DecidedActionForEvaluation } from './preference-evaluation';

export async function recordEvaluationCase(websiteId: string, action: DecidedActionForEvaluation): Promise<void> {
  try {
    const evaluations = await db.preferenceEvaluation.findMany({
      where: { websiteId, status: { in: ['pending', 'evaluating'] } },
    });

    for (const evaluation of evaluations) {
      const classification = classifyEvaluationCase(action, evaluation.evaluatedPhrase, evaluation.excludedActionIds);

      try {
        await db.preferenceEvaluationCase.create({
          data: { evaluationId: evaluation.id, actionId: action.actionId, classification },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // already recorded
        throw err;
      }

      const counts = {
        supportingCount: evaluation.supportingCount + (classification === 'supporting' ? 1 : 0),
        counterCount: evaluation.counterCount + (classification === 'counter_evidence' ? 1 : 0),
        neutralCount: evaluation.neutralCount + (classification === 'neutral' || classification === 'invalid' ? 1 : 0),
      };
      const status = decideEvaluationStatus(counts);

      await db.preferenceEvaluation.update({
        where: { id: evaluation.id },
        data: {
          ...counts,
          status: status === 'insufficient_evidence' ? 'evaluating' : status,
          ...(status === 'passed' || status === 'failed' ? { completedAt: new Date() } : {}),
        },
      });
    }
  } catch (err) {
    console.error('recordEvaluationCase failed, not surfaced to the decision route:', err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/preference-evaluation-events.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Wire `recordEvaluationCase` into the three decision routes**

In `src/app/api/actions/[actionId]/approve/route.ts`, add `import { recordEvaluationCase } from '@/lib/preference-evaluation-events';` and, immediately after the existing `await db.$transaction([...])` call (not inside it), add:

```typescript
  await recordEvaluationCase(action.website.id, { actionId: action.id, decision: 'approved', draftContent: action.draftContent });
```

(`action.website` is already included in this route's existing `db.action.findUnique` call — confirm this before assuming, and if it isn't, add `website: true` to the existing `include`.)

In `src/app/api/actions/[actionId]/reject/route.ts`, add the same import and, after its `$transaction` call:

```typescript
  await recordEvaluationCase(action.websiteId, { actionId: action.id, decision: 'rejected', draftContent: action.draftContent });
```

(This route's `db.action.findUnique` has no `include`, but `action.websiteId` is a plain scalar field on `Action` and is always present without one.)

In `src/app/api/actions/[actionId]/edit/route.ts`, add the same import. This route already computes the original (pre-edit) content and the new content in local variables before its `$transaction` call — read the file to find their exact names (likely `action.draftContent` for the original, before the update, and `draftContent.trim()` for the new value submitted in the request body) and add, after the transaction:

```typescript
  await recordEvaluationCase(action.websiteId, {
    actionId: action.id,
    decision: 'edited',
    draftContent: draftContent.trim(),
    originalDraftContent: action.draftContent,
  });
```

Use the exact variable names actually present in the file — do not guess if they differ from this sketch.

- [ ] **Step 6: Create the initial `PreferenceEvaluation` row when a candidate becomes `approved_for_evaluation`**

In `src/app/api/preference-candidates/[id]/decide/route.ts`, add `import { EVALUATOR_VERSION } from '@/lib/preference-evaluation';` and, after the existing `const updated = await db.preferenceCandidate.update(...)` call, add:

```typescript
  if (status === 'approved_for_evaluation') {
    await db.preferenceEvaluation.create({
      data: {
        candidateId: candidate.id,
        clientProfileId: candidate.clientProfileId,
        websiteId: candidate.websiteId,
        targetField: candidate.targetField,
        evaluatedPhrase: editedPhrase ?? candidate.originalProposedPhrase,
        excludedActionIds: candidate.evidenceEntryIds,
        status: 'pending',
        evaluatorVersion: EVALUATOR_VERSION,
        sourceFingerprint: candidate.sourceFingerprint,
      },
    });
  }
```

Note: `candidate` here is the row fetched earlier in the route (before the `update` call) — it already has `clientProfileId`, `websiteId`, `targetField`, `originalProposedPhrase`, `evidenceEntryIds`, `sourceFingerprint` from the existing `db.preferenceCandidate.findUnique` call; no new query needed. Since `PreferenceEvaluation.candidateId` is `@unique` and `decide/route.ts` already rejects re-deciding a non-`proposed` candidate (returns 400 before reaching this code), a duplicate evaluation row for the same candidate cannot occur through this route.

- [ ] **Step 7: Update tests for approve/reject/edit and decide routes**

For each of the three action-decision route test files, mock `@/lib/preference-evaluation-events` (`vi.mock('@/lib/preference-evaluation-events', () => ({ recordEvaluationCase: vi.fn() }))`) and add one assertion per file confirming `recordEvaluationCase` was called with the right `decision` value and content after a successful decision. For `decide/route.test.ts`, add a test confirming `db.preferenceEvaluation.create` is called with the right shape when `decision: 'evaluate'` succeeds, and confirm it is NOT called for `decision: 'reject'`.

- [ ] **Step 8: Run the full check**

Run: `npx vitest run` — expect all tests passing.
Run: `npx tsc --noEmit` — expect clean.
Run: `npx next build` — expect clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/preference-evaluation-events.ts src/lib/preference-evaluation-events.test.ts src/app/api/preference-candidates src/app/api/actions
git commit -m "feat: wire automatic evaluation-case recording into decision routes"
```

---

### Task 6: UI — quality-check status surfaces

**Files:**
- Modify: `src/components/review/preference-suggestion-card.tsx`
- Modify: `src/components/settings/learning-section.tsx`
- Modify: `src/components/settings/learning-section.test.tsx`
- Modify: `src/app/review/page.tsx`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Extends `formatCandidateStatusLabel`'s existing status-label pattern with a second function for evaluation status.

- [ ] **Step 1: Add an evaluation-status label function and extend the test**

In `src/components/settings/learning-section.tsx`, add:

```typescript
const EVALUATION_STATUS_LABEL: Record<string, string> = {
  pending: 'Quality check in progress',
  evaluating: 'Quality check in progress',
  insufficient_evidence: 'More evidence needed',
  passed: 'Quality check passed — ready for activation',
  failed: 'Quality check did not pass',
};

export function formatEvaluationStatusLabel(status: string): string {
  return EVALUATION_STATUS_LABEL[status] ?? status;
}
```

Add to `learning-section.test.tsx`:

```typescript
describe('formatEvaluationStatusLabel', () => {
  it('maps every known evaluation status to honest customer wording', () => {
    expect(formatEvaluationStatusLabel('pending')).toBe('Quality check in progress');
    expect(formatEvaluationStatusLabel('evaluating')).toBe('Quality check in progress');
    expect(formatEvaluationStatusLabel('insufficient_evidence')).toBe('More evidence needed');
    expect(formatEvaluationStatusLabel('passed')).toBe('Quality check passed — ready for activation');
    expect(formatEvaluationStatusLabel('failed')).toBe('Quality check did not pass');
  });

  it('falls back to the raw status for an unrecognized value', () => {
    expect(formatEvaluationStatusLabel('some_future_status')).toBe('some_future_status');
  });
});
```

- [ ] **Step 2: Extend `CandidateRow` and the Settings query to carry evaluation status**

In `src/app/settings/page.tsx`, add `evaluation: { select: { status: true } }` to the `candidates` query's `select` block.

In `learning-section.tsx`'s `CandidateRow` interface, add `evaluationStatus: string | null;`. In the row rendering, replace the single `formatCandidateStatusLabel(c.status)` span with: if `c.status === 'approved_for_evaluation' && c.evaluationStatus`, show `formatEvaluationStatusLabel(c.evaluationStatus)` instead; otherwise keep the existing `formatCandidateStatusLabel(c.status)`.

- [ ] **Step 3: Update the Review page and card to show the in-progress state**

In `src/app/review/page.tsx`, the `existingProposed` query only ever selects `status: 'proposed'` candidates (the card's job is the pre-decision suggestion) — once a candidate moves to `approved_for_evaluation`, it should stop showing the decision card entirely, since there's nothing left to decide. Confirm this is already true (the query's `where: { status: 'proposed' }` already excludes `approved_for_evaluation` candidates) — no change needed here beyond what Task 3 already added.

In `preference-suggestion-card.tsx`, after a successful "Evaluate this preference" click (the existing `decide('evaluate')` path), instead of simply hiding the card (`setDismissed(true)`), replace its content with:

```tsx
      {dismissed ? null : evaluateSucceeded ? (
        <CardContent className="flex flex-col gap-2 pt-6">
          <p className="text-sm text-foreground">Quality check in progress</p>
          <p className="text-xs text-muted-foreground">
            Dex will compare this preference with future reviewed drafts. No action is needed. Your active preferences
            have not changed.
          </p>
        </CardContent>
      ) : (
        /* existing card content */
      )}
```

Add an `evaluateSucceeded` boolean state, set `true` only when `decide('evaluate')` succeeds (not on reject — a rejected candidate should just disappear, matching existing behavior). Read the component's current structure first and adapt this sketch to fit its real control flow rather than replacing wholesale.

- [ ] **Step 4: Run the full check**

Run: `npx vitest run` — expect all passing.
Run: `npx tsc --noEmit` — expect clean.
Run: `npx next build` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/review/preference-suggestion-card.tsx src/components/settings/learning-section.tsx src/components/settings/learning-section.test.tsx src/app/review/page.tsx src/app/settings/page.tsx
git commit -m "feat: show quality-check status on suggested-preference surfaces"
```

---

### Task 7: Full regression, browser verification, independent review, and deploy

**Files:** none (verification + deployment only)

- [ ] **Step 1: Full verification**

Run in order: `npx vitest run`, `npx tsc --noEmit`, `npx next build`. All must pass. Restart any live local dev server afterward.

- [ ] **Step 2: Migration integrity, outside the sandbox**

Run (env sourced, unsandboxed): `npx prisma migrate status` — confirm the new migration shows applied, zero pending.

- [ ] **Step 3: Visual verification on real data, with controlled fixtures where production data doesn't naturally contain the states**

Using the project's `browse` skill against an authenticated session: confirm approving a suggestion (if any real `proposed` candidate exists — none did as of Phase 8B's own verification pass, so this may need a manually-created test candidate/fixture in a dev database, not production) transitions the card to the "Quality check in progress" state, confirm `ClientProfile.restrictedWording` is unchanged after, confirm Settings shows correct website attribution and the right evaluation-status label. Test desktop and 375px mobile layouts. If production data genuinely can't produce an `insufficient_evidence`/`passed`/`failed` state, say so honestly rather than fabricating a production pass result — verify those specific states via the unit tests from Tasks 4-5 instead, and note in the completion doc which states were only unit-verified vs. browser-verified.

- [ ] **Step 4: Independent review**

Dispatch a fresh subagent (no shared context) as an independent reviewer (Agent B), checking specifically: can inference-source evidence ever leak into an evaluation's case count (trace `excludedActionIds` end to end)? Can the same action be double-counted across a retry (trace the `P2002` idempotency path)? Can cross-tenant or cross-website data enter an evaluation (trace `recordEvaluationCase`'s `websiteId` scoping)? Does anything in this diff write to `ClientProfile.restrictedWording` (grep every touched file)? Does the TOCTOU fix from Task 2 actually close the race, or just narrow it? Report findings; fix all Critical/Important findings in one consolidated pass before deploying; record Minor findings honestly.

- [ ] **Step 5: Deploy**

```bash
npx prisma migrate deploy
vercel deploy --prod --yes
```

Confirm the alias: `vercel inspect dex-ai-plum.vercel.app` — printed `id` must match the deployment just created.

- [ ] **Step 6: Record completion**

Append a section to `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md`, matching this session's established per-slice entries: what shipped, commit SHAs, deployment id, and this accurate completion statement:

> Phase 8C quality-check foundation shipped: approved suggestions are evaluated automatically in shadow mode using independent customer evidence. Evaluation cannot modify active preferences, inference evidence is excluded, and insufficient or conflicting evidence is reported honestly. Versioned activation and rollback remain Phase 8D.

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "docs: record Phase 8C quality-check foundation completion"
```

---

## Self-Review Notes

- **Spec coverage:** all four preflight repairs (Task 1's doc fixes, Task 2's TOCTOU fix, Task 3's website attribution, Task 5's tenant-reconfirmation-by-construction since every write derives its `websiteId`/`clientProfileId` from the already-tenant-scoped `action`/`candidate` row, never a passed-in value), the full evaluation lifecycle (Task 1 schema, Task 4 classification/threshold, Task 5 event wiring + evaluation creation), customer-facing copy (Task 6), and deploy/completion (Task 7) — all covered.
- **Placeholder scan:** none found. Task 5 Step 5's edit-route wiring is deliberately described as "read the file first, use the real variable names" rather than guessed code, since the plan's author didn't have the edit route's exact current variable names in hand when writing this — this is an explicit "verify against the real file" instruction, not a placeholder.
- **Type consistency:** `DecidedActionForEvaluation` (Task 4) used identically in Task 5's `recordEvaluationCase` signature and its three call sites. `EvaluationCounts`/`EvaluationStatus`/`decideEvaluationStatus` (Task 4) match their usage in Task 5's count-update logic exactly.
- **Risk flagged for the implementer:** Task 6 Step 3's card-state sketch is explicitly marked as needing adaptation to the component's real current structure (its exact state variables, its exact conditional-rendering shape) rather than a literal drop-in replacement, since Phase 8B's fix wave already modified this file once and the plan's author is working from the version at commit `94ed0c0`, not a fresh read.
