# Phase 8C — Automatic Preference Quality Check (design)

Brainstormed 2026-09-20, continuing from `94ed0c0` and the live Phase 8B deployment. Full directive received verbatim from the user — this doc grounds it in the actual current codebase (exact schema, exact files, exact trigger points) and resolves the specific technical decisions the directive left open (the TOCTOU fix mechanism, the exact evidence-classification rules, the pass/fail threshold, the exact hook points).

## Mission

Evaluate `approved_for_evaluation` restricted-wording candidates automatically, using independent customer evidence, before anything can modify active preferences. The customer never manages another queue, never starts an evaluation manually, never sees holdout terminology.

**This is not Phase 8B extended — it is a separate, additive layer.** Phase 8B's candidate lifecycle (`proposed`/`approved_for_evaluation`/`rejected`/`superseded`) is untouched. This phase adds a parallel evaluation lifecycle on top of `approved_for_evaluation` candidates only.

## Preflight repairs (before any new code)

Four real risks from Phase 8B's own final review, closed first:

**1. TOCTOU race on the check route.** Confirmed in `src/app/api/websites/[id]/preference-candidates/check/route.ts`: the flow is read (`preferenceCandidateCheck.findUnique`) → LLM call → write (`upsert`), with no atomicity between the read and the write. Two concurrent requests with the same new fingerprint can both pass the "differs from stored" check and both call the LLM.

Fix: replace the read-then-decide-then-write flow with an atomic claim, using the row's own uniqueness as the lock:
1. Attempt `db.preferenceCandidateCheck.updateMany({ where: { websiteId, clientProfileId, targetField, lastFingerprint: { not: fingerprint } }, data: { lastFingerprint: fingerprint, lastOutcome: 'pending', checkedAt: new Date() } })`. If `count === 1`, this request won the claim (Postgres serializes concurrent `UPDATE`s on the same row).
2. If `count === 0`, either no row exists yet, or another request already claimed this exact fingerprint. Attempt `db.preferenceCandidateCheck.create(...)` with the new fingerprint and `lastOutcome: 'pending'`. If this succeeds, this request won the claim (first-ever check for this scope). If it throws Prisma's unique-constraint error (`P2002`), another request won — re-read the row and return its `lastOutcome`.
3. Only the request that won the claim proceeds to the real work (LLM call, verification gate, candidate creation) and then updates the same row with the final outcome.

This closes both the first-ever-check race and the fingerprint-changed race with one mechanism, using Postgres's own row-level locking rather than a new table or advisory lock.

**2. Website attribution missing in learning-history surfaces.** Confirmed: `LearningSection`'s `CandidateRow` (`src/components/settings/learning-section.tsx`) carries no website field, and `src/app/settings/page.tsx`'s `candidates` query doesn't select one. Same gap in `PreferenceSuggestionCard`'s `initialCandidate` (`src/app/review/page.tsx`'s `existingProposed` query) — on a multi-site account, a customer can't tell which site a suggestion is about.

Fix: add `websiteUrl: string` to both the Settings `CandidateRow` and the Review card's `Candidate` shape (via a `select: { website: { select: { url: true } } }` join on both existing queries), rendered inline ("on example.com") in both surfaces. Small, additive, no schema change needed (`Website.url` already exists).

**3. Tenant reconfirmation before every evaluation write.** Design principle for the new code this phase adds, not a fix to existing code: every place that writes a `PreferenceEvaluation`/`PreferenceEvaluationCase` row re-derives and checks tenant ownership from the actual `Action`/`Website`/`ClientProfile` chain immediately before that specific write — mirroring the same pattern `decide/route.ts` already established (`candidate.clientProfile.customerId !== customer.id`), not trusting a value passed in from an earlier step in the same request.

**4. Design-doc/code wording mismatches.** Two edits to the existing `docs/superpowers/specs/2026-09-20-phase8b-suggested-preferences-design.md`, not code changes:
- Condition 4 currently reads "re-verified as belonging to the same tenant... not assumed from the query scoping alone" — this overstates what the code does (no separate re-check exists; the query chain is correctly scoped but there's no discrete verification step). Reword to describe what's actually true: "every query in the check route is built from `websiteId`/`clientProfileId` values that themselves came from `resolveWebsiteForRequest`, so cross-tenant data cannot enter the eligible-edits set — this is scoping correctness, not a separate verification step."
- Data-retention section says "no restrict-cascade" but the shipped migration uses `ON DELETE RESTRICT` on both new tables' foreign keys, matching every other FK in this schema. Reword to: "foreign keys use `ON DELETE RESTRICT`, matching this schema's existing convention throughout — deletion isn't blocked by this feature specifically, it's blocked the same way every other customer-data relation in this schema already is."

Both preflight-repair doc edits happen as part of Task 1, alongside the schema/route work, not as a separate task.

## Evaluation principle

An approved candidate is not evidence the preference is correct — it only authorizes an automatic quality check. Evaluation runs in shadow mode:

- Never blocks or modifies a draft.
- Never modifies `ClientProfile.restrictedWording`.
- Never alters ProofLayer's live result (ProofLayer's checks — `src/lib/proof-layer.ts` — are untouched; evaluation reads decided `Action` rows after the fact, it doesn't sit in the generation/validation path at all).
- Never requires a customer action during evaluation.
- Never calls an LLM for deterministic phrase matching (reuses `phraseAppearsIn` from `src/lib/preference-candidates.ts`, already built in 8B).
- Never describes a candidate as learned, active, or applied.

## Independent evidence

A case must never come from the same evidence that created the candidate. Every `PreferenceCandidate` already carries `evidenceEntryIds` (the `AuditLogEntry` IDs used at inference time) — every new independent case is checked against this list and excluded if it overlaps.

**Trigger points, resolved:** the directive names three trigger classes ("candidate becomes `approved_for_evaluation`", "a subsequent draft is generated", "a customer approves/rejects/edits an eligible draft"). Grounded against the actual codebase: `Action` rows are created deep inside `run-scan.ts`'s scan pipeline (`db.action.create` at lines 451/481), a large, already-complex file — and a freshly-generated, still-`pending` draft has no decision yet, so it can't be classified as `supporting`/`counter_evidence` under the rules below regardless. **The only hook points that can actually produce a classifiable case are the three decision routes**: `src/app/api/actions/[actionId]/approve/route.ts`, `reject/route.ts`, `edit/route.ts` (not `revert/route.ts` — reverting undoes a decision, it doesn't establish one). "Candidate becomes `approved_for_evaluation`" is the point where a candidate first becomes eligible to receive cases, not itself a source of a case. No hook is added to `run-scan.ts`.

**Classification, made deterministic and explicit** (the directive names the four categories; here is the exact rule per event type, derived from its own stated principles):

For a decided `Action` on the same `(websiteId, clientProfileId)` as an `approved_for_evaluation` candidate, checked against the candidate's effective phrase (`customerEditedPhrase ?? originalProposedPhrase`) via `phraseAppearsIn`:

- **Reject events → always `neutral`.** Rejecting a whole draft doesn't isolate a preference about one phrase — matches the directive's own "the customer decision does not establish a preference" clause exactly.
- **Approve events:** phrase present in `draftContent` → `counter_evidence` (the customer explicitly approved text containing the phrase — direct evidence it's acceptable to them). Phrase absent → `neutral` (nothing to evaluate).
- **Edit events:** phrase present in the audit log's `originalDraftContent` (before) and absent from the edited `Action.draftContent` (after) → `supporting` (removed, consistent with the candidate). Phrase present in both before and after (the customer had the chance to remove it and chose not to) → `counter_evidence`. Phrase absent from before → `neutral` (unrelated edit).
- **`invalid`:** the action's evidence overlaps the candidate's own `evidenceEntryIds`/inference source, or the action doesn't belong to the candidate's `(websiteId, clientProfileId)` scope (re-verified per preflight repair 3, not assumed).

Neutral and invalid cases are recorded (for auditability and the idempotency guarantee) but never count toward `supporting`/`counter_evidence` totals.

## Evaluation threshold, defined and justified

`MIN_INDEPENDENT_CASES = 3`. Decision rule, evaluated after every new case:

- Fewer than 3 total `supporting` + `counter_evidence` cases → **`insufficient_evidence`**.
- 3 or more total, and `counter_evidence` count is `> 0` → **`failed`**. `restrictedWording` is a blanket, customer-wide rule, not per-page — a single confirmed case where the customer explicitly kept or approved the phrase is a real logical contradiction to a blanket restriction, not noise to average away. Any real counter-evidence disqualifies a pass, matching the directive's explicit "must not pass when real counter-evidence shows the wording is acceptable in some contexts."
- 3 or more `supporting`, zero `counter_evidence` → **`passed`**.

This is deliberately conservative: it takes one real counter-example to block a pass, and three consistent independent removals to earn one. Both numbers are named constants (`MIN_INDEPENDENT_CASES`), not hidden magic numbers, and are revisitable without a schema change.

## Schema

Two new tables, additive only, no existing model touched:

```prisma
model PreferenceEvaluation {
  id                   String    @id @default(cuid())
  candidateId          String    @unique
  candidate            PreferenceCandidate @relation(fields: [candidateId], references: [id])
  clientProfileId      String
  clientProfile        ClientProfile @relation(fields: [clientProfileId], references: [id])
  websiteId            String
  website              Website   @relation(fields: [websiteId], references: [id])
  targetField          String
  evaluatedPhrase       String
  excludedActionIds     String[]
  supportingCount       Int      @default(0)
  counterCount          Int      @default(0)
  neutralCount           Int      @default(0)
  status                String   // 'pending' | 'evaluating' | 'passed' | 'failed' | 'insufficient_evidence'
  decisionRationale      String?
  evaluatorVersion        String
  sourceFingerprint       String?
  limitations             String?
  startedAt               DateTime @default(now())
  completedAt             DateTime?

  cases PreferenceEvaluationCase[]

  @@index([websiteId, status])
}

model PreferenceEvaluationCase {
  id                   String   @id @default(cuid())
  evaluationId         String
  evaluation           PreferenceEvaluation @relation(fields: [evaluationId], references: [id])
  actionId             String
  classification        String  // 'supporting' | 'counter_evidence' | 'neutral' | 'invalid'
  evidenceExcerpt        Json?
  createdAt              DateTime @default(now())

  @@unique([evaluationId, actionId])
  @@index([actionId])
}
```

`PreferenceEvaluation.candidateId` is `@unique` — one evaluation per candidate, created the moment a candidate becomes `approved_for_evaluation` (status starts `pending`, moves to `evaluating` on its first real case, `passed`/`failed`/`insufficient_evidence` once the threshold logic resolves). `PreferenceEvaluationCase`'s `@@unique([evaluationId, actionId])` is the idempotency guarantee the directive requires: a duplicate event for the same action on the same evaluation is a caught unique-constraint violation, a safe no-op, not a double-count. `supportingCount`/`counterCount`/`neutralCount` on the parent row are denormalized aggregates, updated transactionally alongside each new case insert — read-heavy surfaces (Review, Settings) never need to `COUNT` the child table.

`excludedActionIds` mirrors the candidate's own inference-source `evidenceEntryIds`/action IDs at evaluation-creation time, so exclusion is a fast in-memory check, not a join back to the candidate on every event.

## Event handlers — fast, deterministic, bounded, idempotent

In each of `approve/route.ts`, `reject/route.ts`, `edit/route.ts`, after the existing decision-recording transaction (not blocking it): look up any `PreferenceEvaluation` rows with `status IN ('pending', 'evaluating')` for this action's `(websiteId, clientProfileId)`. For each, classify per the rules above, attempt to insert the `PreferenceEvaluationCase` (idempotent via the unique constraint — a `P2002` on retry is caught and treated as already-processed, not an error), and if the insert succeeded, update the parent `PreferenceEvaluation`'s counts and re-run the threshold decision. This is a handful of indexed queries, no LLM call, no network call beyond the database — genuinely fast, matching "Event handlers must remain fast."

No background job, no queue — this executes inline in the same request that already records the decision, the same pattern this project uses everywhere else (matching the directive's own "Do not add a background-job claim when no queue exists").

## Customer experience

After "Evaluate this preference," the `PreferenceSuggestionCard` (or its replacement state) shows:

> Quality check in progress
> Dex will compare this preference with future reviewed drafts. No action is needed. Your active preferences have not changed.

Settings → Learning, per-row status (extending `formatCandidateStatusLabel`'s existing map with the evaluation status once one exists): "Quality check in progress," "More evidence needed" (`insufficient_evidence`), "Quality check passed," "Quality check did not pass." A passed evaluation shows **"Ready for activation"** — not activated, not "learned," not "applied." Concise supporting evidence (the real case excerpts) only inside an expandable disclosure, matching Phase 8B's existing evidence-disclosure pattern.

No new nav item, no badge, no fingerprint/model/prompt terminology, no manual "Run evaluation" button, no fabricated progress percentage (no "2 of 5 drafts reviewed" — the directive explicitly bans this, and there's no way to know the denominator in advance since it depends on future customer behavior).

## Explicitly out of scope, this slice

- Versioned promotion ("Start using") and rollback ("Undo") — Phase 8D.
- Anything that writes to `ClientProfile.restrictedWording`.
- A UI affordance for a customer to manually trigger or accelerate evaluation.
- Cross-website evidence pooling (each website's candidate is evaluated only against that website's own decided actions, matching how Phase 8B scoped candidate creation).

## Testing

Every case in the directive's "Required tests" list, mapped to the design above:
- Inference evidence exclusion → `excludedActionIds` check, unit-testable pure function.
- Supporting / counter-evidence / neutral classification → one test per event-type/phrase-presence combination in the table above.
- Insufficient evidence / passed / failed decisions → threshold logic, pure function, `MIN_INDEPENDENT_CASES` boundary cases.
- Idempotent repeated events → duplicate `(evaluationId, actionId)` insert attempt, confirm no double-count.
- Concurrent-trigger protection → the check route's compare-and-swap claim (preflight repair 1), plus the evaluation-case unique constraint doubling as its own concurrency guard for case recording.
- No write to `ClientProfile.restrictedWording` → grep-style assertion across all touched files, same as Phase 8A/8B's own review convention.
- Customer-edited candidate phrase evaluated correctly → classification uses `customerEditedPhrase ?? originalProposedPhrase`, tested explicitly.
- Rejected/superseded candidates never evaluated → no `PreferenceEvaluation` row is ever created for a candidate that isn't `approved_for_evaluation` at creation time.
- Tenant/client-profile/website isolation → same pattern as every other route's isolation test in this codebase.
- Historical candidates still render → Phase 8B's existing Review/Settings tests re-run unmodified.
- Review remains usable when evaluation fails → event handlers never throw in a way that blocks the decision route's own response; a case-recording failure is caught and logged, not surfaced to the customer.
- Public URL-only audit / ProofLayer unchanged → no test needed beyond confirming zero lines touched in `proof-layer.ts` or the URL-only scan path.
