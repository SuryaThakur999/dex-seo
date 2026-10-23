# ActionProvenance — producer/worker wiring note (gates 4-5, for Pam)

Short pattern note, not a new plan. Schema is already migrated on
`feature/action-provenance-schema` (see `docs/superpowers/plans/2026-10-11-action-provenance.md`
and its gate1/3 evidence). This covers only *how* the six producers in
`src/lib/generation-dispatch.ts` and the success transaction in
`src/lib/generation-worker.ts` should populate `ActionProvenance`/`ActionProvenanceFinding`.
Scope stays the success path only — no failure-record contract exists yet.

## 1. executionId

Assign one `crypto.randomUUID()` in `claimAndRunGenerationJob` right after the job is claimed
(next to where `attempts` is incremented), before `runGenerator` is called. Pass it down through
`GenerationContext` (or as a separate argument) so every producer's outcome can carry it back
without each producer generating its own.

## 2. The real gap: Finding IDs aren't available today

`GenerationPayload` (`src/lib/generation-payload.ts`) has no `findingId` field on any variant.
`run-scan.ts` enqueues jobs after calling `prisma.finding.createMany(...)` — and `createMany`
does not return the created rows' IDs. So the Finding objects run-scan.ts holds in memory at
enqueue time (`seoFindings`, `brandFindings`, etc.) are not yet linked to their DB rows by the
time `enqueueGenerationJob` runs.

Pick one, don't invent a third:
- Switch the relevant `createMany` calls to a loop of individual `create`s (you get `id` back),
  only for findings that actually feed a generation job (canonical/structured-data/entity-markup/
  restricted-wording/internal-link rule IDs) — leave unrelated findings (geo, brand-without-job)
  on `createMany` as-is.
- Or re-query Finding by `(websiteId, pageUrl, ruleId, retrievedAt)` right after `createMany` —
  more fragile if two findings on the same page share a ruleId.

Either way: add `findingId: string | null` to each `GenerationPayload` variant that has a real
causal Finding (all six do, conceptually — `meta_description`'s finding is the SEO specialist's
missing/short-description rule, etc.). `null` means `findingAssociation: 'unavailable'`, not
`'causal'` — don't default-guess into `'causal'` when the ID didn't make it through.

## 3. Producer-level pattern (generation-dispatch.ts)

Each of the six `generate*Outcome` functions already returns `GenerationOutcome`. Extend that
interface with a `provenance` sub-object every producer fills in the same shape:

```ts
provenance: {
  producerKind: 'model' | 'deterministic';      // model: meta_description, restricted_wording_fix,
                                                   // internal_link_fix (all call an LLM). deterministic:
                                                   // canonical_fix, structured_data_fix, entity_markup_fix.
  producerVersion: string;                        // bump when a producer's prompt/template changes
  findingAssociation: 'causal' | 'input_only' | 'unavailable';
  associationReason: string | null;
  generatorInputsSnapshot: unknown;                // exactly what was passed to draftX()/generateX() — reuse the payload fields already in scope, don't re-derive
  generatorInputsVersion: string;
  validatorInputsSnapshot: unknown | null;         // what runProofLayer/validateX() actually checked against
  validatorInputsVersion: string | null;
}
```

Keep this mechanical — each producer already has every value this needs sitting in scope
(`payload`, `ctx`, the thing it just generated). Don't fetch anything new.

## 4. Worker-level pattern (generation-worker.ts)

In the existing success `$transaction` block (the one that creates/updates `Action` +
`GuardResult` + updates `GenerationJob.resultActionId`), add one more write using the `actionId`
already resolved in that block:

```ts
await tx.actionProvenance.create({
  data: {
    executionId,                                  // from step 1
    customerId: job.customerId,
    websiteId: job.websiteId,
    clientProfileIdAtExecution: ctx.clientProfileIdSnapshot ?? null,  // snapshot, not live FK
    actionId,
    generationJobId: job.id,
    attemptNumber: attempts,
    actionType: job.actionType,
    producerKind: outcome.provenance.producerKind,
    producerVersion: outcome.provenance.producerVersion,
    provider: outcome.provenance.producerKind === 'model' ? GENERATION_PROVIDER : null,
    model: outcome.provenance.producerKind === 'model' ? GENERATION_MODEL : null,
    findingAssociation: outcome.provenance.findingAssociation,
    associationReason: outcome.provenance.associationReason,
    enqueueInputsSnapshot: payload as Prisma.InputJsonValue,
    enqueueInputsVersion: 'v1',
    generatorInputsSnapshot: outcome.provenance.generatorInputsSnapshot as Prisma.InputJsonValue,
    generatorInputsVersion: outcome.provenance.generatorInputsVersion,
    validatorInputsSnapshot: outcome.provenance.validatorInputsSnapshot as Prisma.InputJsonValue | null,
    validatorInputsVersion: outcome.provenance.validatorInputsVersion,
    inputsCapturedAt: new Date(),
    inputsDigest: sha256Hex(JSON.stringify(payload)),
    checkedBytes: outcome.draftContent,
    checkedBytesSha256: sha256Hex(outcome.draftContent),
    validatorKind: 'proof-layer-or-deterministic-validator-name',
    checkedAt: new Date(),
    guardOutcome: outcome.guardResult.outcome,
    checksRun: outcome.guardResult.checksRun as Prisma.InputJsonValue,
    reasoning: outcome.guardResult.reasoning,
    findings: payload.findingId && outcome.provenance.findingAssociation === 'causal'
      ? { create: [{ findingId: payload.findingId, ruleId: ..., ruleVersion: ..., agent: ..., pageUrl: ..., evidence: ..., limitations: ..., retrievedAt: ... }] }
      : undefined,
  },
});
```

Where the `ActionProvenanceFinding` fields are copied from the actual `Finding` row (fetch it
inside the transaction by `payload.findingId`, verify `customerId`/`websiteId` match `job.*`
before trusting it — this is the tenant-consistency check the plan calls for, done in app code
since there's no DB-level composite FK).

Same write does **not** happen on the failure branch (`attempts >= GENERATION_MAX_ATTEMPTS`) or
on cancellation — those are explicitly out of scope per the plan.

## 5. What gate 6 (mine) checks against this

- Runtime DB role has no `UPDATE`/`DELETE` grant on `ActionProvenance`/`ActionProvenanceFinding`.
- A `findingId` whose Finding belongs to a different customer/website than the job never gets
  linked (test: mismatched tenant → `associationReason` set, no join row created, not a thrown
  error that fails the whole generation).
- Retrying a job writes a second `ActionProvenance` row with a new `executionId`, never
  overwrites the first.
