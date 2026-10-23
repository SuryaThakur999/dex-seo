# Council Decision Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing (currently dead-code) `buildDecisionRecord` function into the real Opportunity Board data flow, extend it to the full field set the master directive's §9 (Controlled Team Discussion) specifies, and surface it in the existing "Combined" expandable detail panel — closing the real gap where Phase 7A built the function but never called it.

**Architecture:** Pure extension of two existing library files (`agent-orchestrator.ts`, `opportunity-board.ts`) plus one existing component (`opportunity-board.tsx`). No new files, no new database table, no new UI surface. Every new field is either computed from real data already in hand, or an honest literal-type empty state (`agreement: 'agreed'`, `disagreement: null`, `owner: 'not_applicable'`) — confirmed in the design doc that no real conflict case exists today to back a broader type.

**Tech Stack:** TypeScript, Vitest, React (server component `OpportunityBoard`), Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-17-council-decision-record-design.md` — read it before starting; this plan implements it exactly, do not widen scope.
- `agreement`, `disagreement`, `confidence` are narrow literal types (`'agreed'`, `null`, `'high'`) by design — do not generalize them to broader unions in this plan.
- No new UI surface — extend the existing `<details>` panel in `opportunity-board.tsx` only.
- Full test suite (`npx vitest run`), `npx tsc --noEmit`, and `npx next build` must stay green after every task.
- Running `next build` corrupts a live `next dev` server's chunk manifest on this machine — if `next dev` is running, restart it after any `next build` (established this session, see `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md`).

---

### Task 1: Extend `DecisionRecord` and `buildDecisionRecord` in `agent-orchestrator.ts`

**Files:**
- Modify: `src/lib/agent-orchestrator.ts:53-72` (the `DecisionRecord` interface and `buildDecisionRecord` function)
- Test: `src/lib/agent-orchestrator.test.ts`

**Interfaces:**
- Consumes: `ConsolidatedOpportunity` (existing, unchanged — `src/lib/agent-orchestrator.ts:42-48`), `SEVERITY_RANK` (existing, `src/lib/agent-orchestrator.ts:80`), `OBSERVATION_WINDOW_DAYS` from `src/lib/dashboard-stats.ts:564` (new import).
- Produces: `DecisionRecommendation` (new exported interface), extended `DecisionRecord` (new fields: `recommendations`, `agreement`, `disagreement`, `finalRecommendation`, `confidence`, `limitations`, `owner`, `measurementPlan`), `buildDecisionRecord(opportunity, now?)` returning the extended shape — same call signature as today, callers unaffected.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/agent-orchestrator.test.ts`, inside the existing `describe('buildDecisionRecord', ...)` block:

```ts
  it('builds the full council fields with honest real-population values', () => {
    const { consolidated } = consolidateFindings([
      f({ pageUrl: '/', ruleId: 'missing_structured_data', agent: 'seo_specialist', severity: 'medium', suggestedAction: 'Add JSON-LD.', limitations: 'Homepage only.' }),
      f({ pageUrl: '/', ruleId: 'missing_entity_markup', agent: 'geo_specialist', severity: 'high', suggestedAction: 'Add Organization schema.', limitations: null }),
    ]);
    const record = buildDecisionRecord(consolidated[0], new Date('2026-01-01T00:00:00Z'));

    expect(record.recommendations).toHaveLength(2);
    expect(record.recommendations.map((r) => r.agent).sort()).toEqual(['geo_specialist', 'seo_specialist']);
    expect(record.recommendations.find((r) => r.agent === 'seo_specialist')).toEqual({
      agent: 'seo_specialist',
      ruleId: 'missing_structured_data',
      suggestedAction: 'Add JSON-LD.',
      limitations: 'Homepage only.',
    });
    expect(record.agreement).toBe('agreed');
    expect(record.disagreement).toBeNull();
    // geo_specialist's finding is 'high' severity, seo_specialist's is 'medium' — the higher one wins.
    expect(record.finalRecommendation).toBe('Add Organization schema.');
    expect(record.confidence).toBe('high');
    expect(record.limitations).toBe('Homepage only.');
    expect(record.owner).toBe('not_applicable');
    expect(record.measurementPlan).toContain('28');
  });

  it('joins limitations from both contributors when both are present, and is null when neither has one', () => {
    const bothNull = consolidateFindings([
      f({ pageUrl: '/', ruleId: 'missing_structured_data', agent: 'seo_specialist', limitations: null }),
      f({ pageUrl: '/', ruleId: 'missing_entity_markup', agent: 'geo_specialist', limitations: null }),
    ]).consolidated;
    expect(buildDecisionRecord(bothNull[0]).limitations).toBeNull();

    const bothPresent = consolidateFindings([
      f({ pageUrl: '/', ruleId: 'missing_structured_data', agent: 'seo_specialist', limitations: 'A.' }),
      f({ pageUrl: '/', ruleId: 'missing_entity_markup', agent: 'geo_specialist', limitations: 'B.' }),
    ]).consolidated;
    expect(buildDecisionRecord(bothPresent[0]).limitations).toBe('A. B.');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/agent-orchestrator.test.ts`
Expected: FAIL — `record.recommendations` is `undefined`, `record.agreement` is `undefined`, etc. (the fields don't exist yet).

- [ ] **Step 3: Write the implementation**

In `src/lib/agent-orchestrator.ts`, add the import at the top of the file:

```ts
import { OBSERVATION_WINDOW_DAYS } from '@/lib/dashboard-stats';
```

Replace the existing `DecisionRecord` interface and `buildDecisionRecord` function (lines 53-72) with:

```ts
export interface DecisionRecommendation {
  agent: string;
  ruleId: string;
  suggestedAction: string;
  limitations: string | null;
}

// Concise per the priority-fix scope -- not the full 12-field council decision record from the
// broader Phase 7A ask (owner/measurement-plan fields would have no real value behind them
// yet, since no ownership-assignment or measurement-plan feature exists in this codebase).
//
// Extended 2026-09-17 (docs/superpowers/specs/2026-09-17-council-decision-record-design.md) to
// the full §9 field set. agreement/disagreement/confidence are narrow literal types on purpose:
// consolidateFindings only ever fires when two agents independently confirm the same fact, so
// 'agreed'/null/'high' are the only real values that exist today. Widening these types is the
// signal a future session should read before building real conflict detection.
export interface DecisionRecord {
  issue: string;
  resolutionRule: string;
  participatingAgents: string[];
  evidenceRefs: string[];
  reason: string;
  timestamp: string;
  recommendations: DecisionRecommendation[];
  agreement: 'agreed';
  disagreement: null;
  finalRecommendation: string;
  confidence: 'high';
  limitations: string | null;
  owner: 'not_applicable';
  measurementPlan: string;
}

export function buildDecisionRecord(opportunity: ConsolidatedOpportunity, now: Date = new Date()): DecisionRecord {
  const contributors = opportunity.pages.flatMap((p) => p.contributors);
  const recommendations: DecisionRecommendation[] = contributors.map((c) => ({
    agent: c.agent,
    ruleId: c.ruleId,
    suggestedAction: c.suggestedAction,
    limitations: c.limitations,
  }));
  const highestSeverity = contributors.reduce((best, c) => (SEVERITY_RANK[c.severity] >= SEVERITY_RANK[best.severity] ? c : best));
  const limitationsList = [...new Set(contributors.map((c) => c.limitations).filter((l): l is string => Boolean(l)))];

  return {
    issue: opportunity.label,
    resolutionRule: opportunity.ruleId,
    participatingAgents: [...new Set(contributors.map((c) => c.agent))],
    evidenceRefs: contributors.map((c) => `${c.agent}:${c.ruleId}:${c.pageUrl}`),
    reason: opportunity.reason,
    timestamp: now.toISOString(),
    recommendations,
    agreement: 'agreed',
    disagreement: null,
    finalRecommendation: highestSeverity.suggestedAction,
    confidence: 'high',
    limitations: limitationsList.length > 0 ? limitationsList.join(' ') : null,
    owner: 'not_applicable',
    measurementPlan: `Measured via GSC search performance over the standard ${OBSERVATION_WINDOW_DAYS}-day observation window after an approved change goes live, same window Outcomes already uses.`,
  };
}
```

Check `src/lib/dashboard-stats.ts:564` exports `OBSERVATION_WINDOW_DAYS` — if it's not currently exported (only used internally), add `export` to its declaration:

```ts
export const OBSERVATION_WINDOW_DAYS = 28;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/agent-orchestrator.test.ts`
Expected: PASS, all tests in the file (including the two pre-existing ones — verify their assertions on `participatingAgents`/`evidenceRefs`/`resolutionRule`/`timestamp`/`reason` still pass unchanged).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-orchestrator.ts src/lib/agent-orchestrator.test.ts src/lib/dashboard-stats.ts
git commit -m "feat: extend council decision record to full §9 field set

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

### Task 2: Wire `buildDecisionRecord` into `computeOpportunityGroups`

**Files:**
- Modify: `src/lib/opportunity-board.ts:13-36` (the `OpportunityGroup` interface) and `:124-139` (the consolidated-group construction loop)
- Test: `src/lib/opportunity-board.test.ts`

**Interfaces:**
- Consumes: `buildDecisionRecord`, `DecisionRecord` (from Task 1, `src/lib/agent-orchestrator.ts`).
- Produces: `OpportunityGroup.decisionRecord?: DecisionRecord` (new optional field) — Task 3 (the UI) reads this.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/opportunity-board.test.ts`, right after the existing `it('consolidates the verified SEO/GEO zero-JSON-LD duplicate...')` test (around line 128):

```ts
  it('attaches a decision record to consolidated groups, with none on non-consolidated groups', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
        finding({ pageUrl: '/other', ruleId: 'zero_internal_links', severity: 'medium', agent: 'seo_specialist' }),
      ]
    );

    const consolidatedGroup = groups.find((g) => g.key.startsWith('consolidated:'));
    expect(consolidatedGroup?.decisionRecord).toBeDefined();
    expect(consolidatedGroup?.decisionRecord?.agreement).toBe('agreed');
    expect(consolidatedGroup?.decisionRecord?.recommendations).toHaveLength(2);

    const plainGroup = groups.find((g) => g.key === 'finding:zero_internal_links');
    expect(plainGroup?.decisionRecord).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/opportunity-board.test.ts`
Expected: FAIL — `consolidatedGroup?.decisionRecord` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/lib/opportunity-board.ts`:

1. Update the import line at the top (currently `import { consolidateFindings } from '@/lib/agent-orchestrator';`) to:

```ts
import { consolidateFindings, buildDecisionRecord, type DecisionRecord } from '@/lib/agent-orchestrator';
```

2. Add the new field to the `OpportunityGroup` interface, right after the existing `consolidationReason?: string;` line (~line 35):

```ts
  /** Set only on consolidated groups — the full council record backing that consolidation. */
  decisionRecord?: DecisionRecord;
```

3. In the consolidated-group construction loop (~line 124-139), add `decisionRecord` to the pushed object, right after `consolidationReason: opportunity.reason,`:

```ts
      consolidationReason: opportunity.reason,
      decisionRecord: buildDecisionRecord(opportunity),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/opportunity-board.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/opportunity-board.ts src/lib/opportunity-board.test.ts
git commit -m "feat: attach council decision record to consolidated opportunity groups

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

### Task 3: Render the decision record in `OpportunityBoard`'s existing detail panel

**Files:**
- Modify: `src/components/dashboard/opportunity-board.tsx:120-145` (the `<details>` block inside the contributors `<tr>`)

**Interfaces:**
- Consumes: `OpportunityGroup.decisionRecord` (from Task 2).
- Produces: nothing further downstream — this is the leaf UI task.

- [ ] **Step 1: Write the implementation**

No component test harness exists for this file today (check: `find src -iname "opportunity-board.test.tsx"` — if none exists, verification is the manual/visual step below, not a new test framework). In `src/components/dashboard/opportunity-board.tsx`, inside the `<details>` block, find this existing code:

```tsx
                          <div className="mt-2 flex flex-col gap-2">
                            {isConsolidated && <p className="text-xs text-muted-foreground">{group.consolidationReason}</p>}
                            {group.contributors.map((c, i) => (
```

Insert a new block right after the `consolidationReason` paragraph and before `{group.contributors.map(...)}`:

```tsx
                            {group.decisionRecord && (
                              <div className="rounded border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                                <p>Resolution: {group.decisionRecord.resolutionRule}</p>
                                <p>Agreement: {group.decisionRecord.agreement}</p>
                                <p>Final recommendation: {group.decisionRecord.finalRecommendation}</p>
                                <p>Measurement: {group.decisionRecord.measurementPlan}</p>
                              </div>
                            )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (654 pre-existing + the new ones from Tasks 1-2).

- [ ] **Step 4: Visually verify on real data**

This codebase's established verification pattern (see `docs/superpowers/plans/2026-09-14-mission-control-slice-harness.md` and this session's own precedent in `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md`): use `~/.claude/skills/gstack/browse/dist/browse connect` (headed, real Chromium) against the local dev server, sign in with the real account already used this session, navigate to a site whose Opportunity Board shows a "Combined" badge (a page with both `missing_structured_data` and `missing_entity_markup` on the same URL), expand its `<details>` panel, and confirm the four new lines render with real, non-placeholder values. Screenshot and save to `docs/superpowers/evidence/2026-09-17-responsive-release-gate/` following this session's existing naming convention.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/opportunity-board.tsx docs/superpowers/evidence/
git commit -m "feat: surface council decision record in the Combined-opportunity detail panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

### Task 4: Production build and deploy

**Files:** none (verification + deployment only)

- [ ] **Step 1: Full verification**

Run in order: `npx vitest run`, `npx tsc --noEmit`, `npx next build`. All must pass. (Building will corrupt a live `next dev` server's chunk manifest on this machine — restart `npm run dev` afterward if one is running.)

- [ ] **Step 2: Deploy**

```bash
vercel deploy --prod --yes
```

Then confirm the alias serves the new deployment:

```bash
vercel inspect dex-ai-plum.vercel.app
```

Confirm the printed `id` matches the deployment just created.

- [ ] **Step 3: Record completion**

Append a short section to `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md` (matching this session's existing "Responsive release gate, slice N" entries) recording: what shipped, the commit SHAs, the deployment id, and that §9's real-population scope is now complete per `docs/superpowers/specs/2026-09-17-council-decision-record-design.md` — with conflict detection/challenge-round/dissent explicitly still deferred (per that spec's "Out of scope" section).

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "docs: record council decision record completion (master directive §9)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

## Self-Review Notes

- **Spec coverage:** Data model (Task 1) ✓, wiring (Task 2) ✓, UI (Task 3) ✓, testing (Tasks 1-2 inline, Task 3 step 4 visual) ✓, out-of-scope items explicitly not built ✓.
- **Placeholder scan:** none — every step has real code or a real command.
- **Type consistency:** `DecisionRecommendation`, `DecisionRecord`, `decisionRecord?: DecisionRecord` field name, and `buildDecisionRecord(opportunity, now?)` signature are identical across Tasks 1-3.
