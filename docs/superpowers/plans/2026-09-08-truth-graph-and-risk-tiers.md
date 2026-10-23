# Truth Graph v0 + Risk Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 of `docs/superpowers/plans/2026-09-08-assurance-loop-foundation.md`. Give ProofLayer a second source of truth beyond a single page's own content (customer-level approved facts), and give every `Action` a risk tier and policy version — without building the spec's full enterprise Truth Graph (multi-market canonical URLs, source freshness/confidence/approver workflow), which nothing in the current single-site-per-customer product needs yet.

**Architecture:** One new `CustomerFact` table (customer-scoped approved claims). `ProofLayer`'s existing `checkUnverifiableClaims`/`checkContradiction` checks gain a second haystack (approved facts) alongside the page's own title/metaDescription. `Action` gains a `riskTier` enum (derived, not user-set) and a `policyVersion` string constant.

**Tech Stack:** Same as Phase 1 — Next.js 14, Prisma + PostgreSQL, Vitest.

## Global Constraints

Same as Phase 1's Global Constraints section (test-per-change, no `git add -A`, real migrations, commit convention, CLAUDE.md senior-developer + skill-routing rules).

---

### Task 1: Add `CustomerFact` model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via `prisma migrate dev` (interactive) or hand-written SQL + `migrate deploy` if the environment is non-interactive (Phase 1 hit this — same fallback applies)

**Interfaces:**
- Produces: `CustomerFact` model — `id`, `customerId` (FK to `Customer`), `claim` (String, the approved fact text, e.g. "Free plan available"), `category` (String, e.g. `pricing`/`feature`/`policy` — free-form for v0, not an enum, since the real category taxonomy isn't known yet and an enum would need a migration per new category), `createdAt`.

- [ ] **Step 1: Add the model**

```prisma
model CustomerFact {
  id         String   @id @default(cuid())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  claim      String
  category   String
  createdAt  DateTime @default(now())
}
```

Add `customerFacts CustomerFact[]` to the `Customer` model's relation list, alongside the existing `actions`/`auditLogEntries`/`scanJobs`/`pageSnapshots`.

- [ ] **Step 2: Migrate**

```bash
cd /Users/surya/Projects/dex-ai
set -a; source <(grep -v '^#' .env.local | grep '='); set +a
npx prisma migrate dev --name add_customer_fact 2>&1
```

If this errors as non-interactive (Phase 1's exact failure mode), hand-write the migration folder following Phase 1's pattern (`CREATE TABLE "CustomerFact" (...)` with the FK), then `npx prisma migrate deploy`.

- [ ] **Step 3: Generate client, run tests**

```bash
npx prisma generate
npm test
```

Expected: all 129 existing tests still pass (additive schema change, nothing references the new table yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add CustomerFact model for Truth Graph v0

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015EKVrpvJsMwQs9t1eBGWUM"
```

---

### Task 2: Wire approved facts into ProofLayer's claim checks

**Files:**
- Modify: `src/lib/proof-layer.ts`
- Modify: `src/lib/proof-layer.test.ts`
- Modify: `src/lib/run-scan.ts`
- Modify: `src/lib/run-scan.test.ts`

**Interfaces:**
- Consumes: `CustomerFact` rows (an array of `{ claim: string }` passed in, not a live DB query inside `proof-layer.ts` — that file has zero DB dependencies today and should stay that way; `run-scan.ts` already owns all DB access for this flow).
- Produces: `ProofLayerInput` gains `approvedFacts: string[]` (default-safe: existing callers that don't have facts yet pass `[]`).

- [ ] **Step 1: Extend `ProofLayerInput`**

In `src/lib/proof-layer.ts`, add to the interface:

```typescript
export interface ProofLayerInput {
  draftContent: string;
  sourceContent: { title: string | null; metaDescription: string | null };
  aiDisclosure: boolean;
  recentDraftsForCustomer: string[];
  approvedFacts: string[];
}
```

- [ ] **Step 2: Extend the two claim-checking functions to use it**

`checkUnverifiableClaims` currently builds its haystack from `sourceText(source)` only. Change its signature to also take `approvedFacts: string[]`, and extend the haystack:

```typescript
function checkUnverifiableClaims(
  draftContent: string,
  source: { title: string | null; metaDescription: string | null },
  approvedFacts: string[]
): ProofCheckResult {
  const rawHaystack = `${sourceText(source)} ${approvedFacts.join(' ').toLowerCase()}`;
  const normalizedHaystack = normalizeForComparison(rawHaystack);
  // ...rest of the function body is unchanged, it already just reads
  // rawHaystack/normalizedHaystack — no other line needs to change.
```

Same pattern for `checkContradiction` — it currently only checks the hardcoded "out of stock"/"in stock" case against `sourceText(source)`. Extend its haystack the same way (`${sourceText(source)} ${approvedFacts.join(' ').toLowerCase()}`) so an approved fact like "Currently out of stock" also triggers the existing contradiction check, not just the page's own metaDescription.

Update the call sites inside `runProofLayer` to pass `input.approvedFacts` through to both functions.

- [ ] **Step 3: Update the test file**

Add `approvedFacts: []` to `proof-layer.test.ts`'s `baseInput()` default object (keeps every existing test passing unchanged — empty array is a no-op haystack addition). Add two new tests:

```typescript
describe('approved facts as a second source of truth', () => {
  it('passes a claim that appears in an approved fact, not the page content', () => {
    const result = runProofLayer(
      baseInput({
        draftContent: 'The #1 choice for blue widgets.',
        approvedFacts: ['Voted #1 blue widget supplier by Trade Weekly, 2026'],
      })
    );
    expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('pass');
  });

  it('blocks a draft that contradicts an approved fact even when the page itself is silent', () => {
    const result = runProofLayer(
      baseInput({
        draftContent: 'Blue widgets, in stock and ready to ship.',
        sourceContent: { title: 'Blue Widgets', metaDescription: null },
        approvedFacts: ['Currently out of stock — restocking in April'],
      })
    );
    expect(result.outcome).toBe('block');
    expect(result.checksRun.find((c) => c.check === 'no-contradiction')?.result).toBe('fail');
  });
});
```

- [ ] **Step 4: Run tests, verify the two new ones fail before the implementation (sanity check TDD order)**

Since Task 2 Step 2's implementation is written before this point in the plan, this step is really: confirm the new tests pass now that the implementation exists.

```bash
npm test -- proof-layer
```

Expected: all pass, including the 2 new ones.

- [ ] **Step 5: Wire `run-scan.ts` to fetch and pass approved facts**

In `src/lib/run-scan.ts`, inside `runScanForCustomer`, before the `for (const page of flagged)` loop (facts don't change per-page, fetch once):

```typescript
const approvedFacts = (
  await db.customerFact.findMany({ where: { customerId: customer.id }, select: { claim: true } })
).map((f) => f.claim);
```

Add `approvedFacts` to the `runProofLayer({...})` call's input object.

- [ ] **Step 6: Update `run-scan.test.ts`**

Add `customerFact: { findMany: vi.fn(() => []) }` to the `vi.mock('@/lib/db', ...)` mock object (matching the existing `action`/`pageSnapshot`/`scanLogLine` mock pattern already in that file). Default empty array keeps every existing test passing unchanged (no facts fetched, `approvedFacts: []` passed to `runProofLayer`, identical to today's behavior since Step 2's haystack extension is a no-op on an empty array).

Add one new test verifying the fetched facts are actually passed through:

```typescript
it('passes fetched CustomerFact claims through to ProofLayer as approvedFacts', async () => {
  stubOnePageScan();
  (db.customerFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ claim: 'Ships worldwide' }]);
  (db.pageSnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (draftMetaDescription as ReturnType<typeof vi.fn>).mockResolvedValue({ draftContent: 'New description.', tokenCost: 42 });
  (runProofLayer as ReturnType<typeof vi.fn>).mockReturnValue({ outcome: 'pass', checksRun: [], reasoning: 'ok' });
  (decideActionStatus as ReturnType<typeof vi.fn>).mockReturnValue('pending');

  await runScanForCustomer(CUSTOMER, 'job_123');

  expect(runProofLayer).toHaveBeenCalledWith(expect.objectContaining({ approvedFacts: ['Ships worldwide'] }));
});
```

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all pass (existing 129 + new ones from this task).

- [ ] **Step 8: Commit**

```bash
git add src/lib/proof-layer.ts src/lib/proof-layer.test.ts src/lib/run-scan.ts src/lib/run-scan.test.ts
git commit -m "feat: wire CustomerFact approved claims into ProofLayer as a second source of truth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015EKVrpvJsMwQs9t1eBGWUM"
```

---

### Task 3: Add `riskTier` and `policyVersion` to `Action`

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/run-scan.ts`
- Modify: `src/lib/run-scan.test.ts`

**Interfaces:**
- Produces: `RiskTier` enum (`low`, `medium`, `high`) and `Action.riskTier`/`Action.policyVersion` fields. `riskTier` is derived server-side from the `ProofLayerResult`, never user-set — a hard fail on `ai-content-disclosure` or `no-contradiction` is `high` (factual/compliance risk), a hard fail on `no-unverifiable-claims` alone is `medium`, anything else (including a plain `flag` on length/duplicate, or a clean `pass`) is `low`.

- [ ] **Step 1: Add the enum and fields**

```prisma
enum RiskTier {
  low
  medium
  high
}
```

Add to `model Action`: `riskTier RiskTier @default(low)` and `policyVersion String @default("v1")`.

- [ ] **Step 2: Migrate**

```bash
npx prisma migrate dev --name add_action_risk_tier_and_policy_version
```

(Same non-interactive fallback as Task 1 Step 2 if needed — this is a purely additive change with defaults, so it should not hit Phase 1's cast issue at all; a brand-new column with a default value is the simple case Prisma's interactive flow handles without a data-loss warning.)

- [ ] **Step 3: Add the derivation function**

In `src/lib/proof-layer.ts`, export a new pure function (colocated with the checks it interprets, not in `run-scan.ts`, since it's a rule about `ProofCheckResult`s, not about scanning):

```typescript
export function deriveRiskTier(checksRun: ProofCheckResult[]): 'low' | 'medium' | 'high' {
  const failed = new Set(checksRun.filter((c) => c.result === 'fail').map((c) => c.check));
  if (failed.has('ai-content-disclosure') || failed.has('no-contradiction')) return 'high';
  if (failed.has('no-unverifiable-claims')) return 'medium';
  return 'low';
}
```

- [ ] **Step 4: Add tests for `deriveRiskTier`**

In `src/lib/proof-layer.test.ts`:

```typescript
describe('deriveRiskTier', () => {
  it('returns high when AI disclosure is missing', () => {
    const result = runProofLayer(baseInput({ aiDisclosure: false }));
    expect(deriveRiskTier(result.checksRun)).toBe('high');
  });

  it('returns high when the draft contradicts the source', () => {
    const result = runProofLayer(
      baseInput({
        draftContent: 'In stock now.',
        sourceContent: { title: 'Widgets', metaDescription: 'Out of stock.' },
      })
    );
    expect(deriveRiskTier(result.checksRun)).toBe('high');
  });

  it('returns medium for an unverifiable claim with no contradiction or disclosure issue', () => {
    const result = runProofLayer(baseInput({ draftContent: 'The #1 choice for blue widgets.' }));
    expect(deriveRiskTier(result.checksRun)).toBe('medium');
  });

  it('returns low when every check passes', () => {
    const result = runProofLayer(baseInput());
    expect(deriveRiskTier(result.checksRun)).toBe('low');
  });

  it('returns low for a length-only flag', () => {
    const result = runProofLayer(baseInput({ draftContent: 'x'.repeat(200) }));
    expect(deriveRiskTier(result.checksRun)).toBe('low');
  });
});
```

Update the test file's import line to include `deriveRiskTier`.

- [ ] **Step 5: Wire it into `run-scan.ts`**

At the `db.action.create` call in `runScanForCustomer`, add:

```typescript
riskTier: deriveRiskTier(guardResult.checksRun),
policyVersion: 'v1',
```

Import `deriveRiskTier` from `@/lib/proof-layer` alongside the existing `runProofLayer`/`decideActionStatus` import.

- [ ] **Step 6: Update `run-scan.test.ts`**

The existing `db.action.create` mock assertions (if any check the full `data` object shape) need `riskTier`/`policyVersion` added to their expected payload. Grep first:

```bash
grep -n "db.action.create).toHaveBeenCalledWith" src/lib/run-scan.test.ts
```

Update each matched assertion's expected object to include `riskTier: expect.any(String), policyVersion: 'v1'` — read the actual current assertion content before editing, don't guess the surrounding fields.

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/proof-layer.ts src/lib/proof-layer.test.ts src/lib/run-scan.ts src/lib/run-scan.test.ts
git commit -m "feat: derive Action risk tier from ProofLayer checks, add policy version

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015EKVrpvJsMwQs9t1eBGWUM"
```

---

### Task 4: Surface risk tier on the review detail page

**Files:**
- Modify: `src/app/review/[actionId]/page.tsx`

**Interfaces:**
- Consumes: `action.riskTier` (now on the Prisma `Action` model from Task 3).
- Produces: nothing new — a small visible badge, no new component needed (reuse the existing `Badge` component already imported on this page for the outcome badge).

- [ ] **Step 1: Read the current file's badge rendering to match its exact pattern**

```bash
grep -n "Badge\|NEEDS REVIEW\|outcome" "src/app/review/[actionId]/page.tsx" | head -20
```

- [ ] **Step 2: Add a risk-tier badge next to the existing outcome badge**

Read the matched lines in full context before editing (this task has one file, real content required — no placeholder). Add a second `<Badge>` showing `action.riskTier.toUpperCase()` (e.g. "HIGH"), styled with the same conditional-color pattern the outcome badge already uses (reuse existing color-mapping logic/CSS variables from `guard-outcome-ui.ts` if a suitable one exists there, or a minimal inline conditional matching the existing badge's style approach — read that file first to check).

- [ ] **Step 3: Visual verification**

Start the dev server (worktree + `dangerouslyDisableSandbox: true`, established pattern from Phase 1), seed an `Action` with `riskTier: 'high'` via the same direct-DB-seed approach used in this session's earlier Task 7/Phase-1 verification, screenshot `/review/[actionId]` via the `browse` skill, confirm the badge renders.

- [ ] **Step 4: Run the full test suite one more time, then typecheck**

```bash
npm test
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -u "src/app/review/[actionId]/page.tsx"
git commit -m "feat: show risk tier badge on review detail page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015EKVrpvJsMwQs9t1eBGWUM"
```

---

## Self-Review

**Spec coverage:** Phase overview's "Truth Graph v0 + action risk tiers + policy versions" is covered by Tasks 1-3 (schema + wiring); Task 4 is the minimum UI surface needed to make the new field visible/useful rather than a silent DB column. Deliberately NOT covered (per the senior-architect scoping call this session): multi-market canonical URLs, source freshness/confidence/approver workflow, user-settable risk tiers, blast-radius/reversibility modeling — all enterprise-scale per the original spec, none needed at current one-site-per-customer product maturity.

**Placeholder scan:** no TBD/TODO; Task 4 Step 2 has one open "read first, then match the existing pattern" instruction rather than fully pre-written JSX, because the exact existing badge styling isn't known until read — this is a deliberate "verify before writing" step, not a placeholder for missing logic.

**Type consistency:** `approvedFacts: string[]` used identically in Task 2's interface (creation) and Task 2 Step 5's call site (consumption). `RiskTier`/`deriveRiskTier` names consistent between Task 3 Step 3 (creation) and Steps 5-6 (consumption).
