# ActionProvenance — gate 1 preflight + gate 3 schema (checkpoint)

Resolves gate 1 and the schema-design half of gate 3 in
`docs/superpowers/plans/2026-10-11-action-provenance.md`. Gate 2 was already closed by
`docs/superpowers/specs/2026-10-11-action-provenance-retention-decision.md`.

## Gate 1 — preflight refresh against current HEAD

Re-read against current checkout (no fork, read-only):

- `prisma/schema.prisma` — `Action` still has mutable `draftContent` and one optional
  `GuardResult`; `GenerationJob.resultActionId` is still a nullable string with no Prisma
  relation; `Finding` still has no Action relation. Matches the plan's "Current contracts
  verified for planning" section exactly — no drift.
- `src/lib/generation-worker.ts` — `claimAndRunGenerationJob` still claims via atomic
  `updateMany`, builds context fresh at claim time, and commits Action + GuardResult +
  `GenerationJob.resultActionId` in one `$transaction` on success, calling `lockDecisionScope`
  first. Retry (`waiting_retry`, fixed backoff), rate-limit, breaker-block, cancellation, and
  `reapStaleGenerationJobs` all behave as the plan assumes.
- `src/lib/generation-dispatch.ts` — all six producers (`meta_description`, `canonical_fix`,
  `structured_data_fix`, `entity_markup_fix`, `restricted_wording_fix`, `internal_link_fix`)
  confirmed present. None currently pass a causal Finding ID into `GenerationOutcome` — Finding
  linkage is genuinely new work (gate 4), not partially done already.
- `src/lib/action-decision.ts` — `lockDecisionScope` exists and is called the same way by both
  the success and failure transaction branches in `generation-worker.ts`.

Result: no "current behavior differs from this plan" condition found. Gate 1 confirmed clear.

## Gate 3 — schema (design + validation; migration not yet generated)

Added to `prisma/schema.prisma`:

- `ActionProvenance` — append-only, one row per **successful** terminal generation only (the
  plan's separate failure-record contract is unapproved, so failure paths are out of scope for
  this schema). Unique `executionId`; `actionId`/`generationJobId` deliberately not unique
  (retries); `clientProfileIdAtExecution` is a plain string snapshot, not a live FK. Indexes:
  `(customerId, websiteId, createdAt)`, `(actionId, createdAt)`, `(generationJobId,
  attemptNumber)` — no uniqueness on the last one, per the plan.
- `ActionProvenanceFinding` — join row, fields copied at write time (`ruleId`, `ruleVersion`,
  `agent`, `pageUrl`, `evidence`, `limitations`, `retrievedAt`), not read live off `Finding`
  later.
- `ProducerKind` (`model`/`deterministic`) and `FindingAssociationKind`
  (`causal`/`input_only`/`unavailable`) enums.
- Additive back-relation arrays on `Customer`, `Website`, `Action`, `Finding` (Prisma requires
  both sides of a relation declared).

Tenant-consistency enforcement (provenance/Action/Finding/customer/website ownership agreeing)
is **not** a DB-level composite FK/check constraint here — left as an application-layer check at
write/read time, consistent with how `lockDecisionScope` already enforces this elsewhere in the
codebase. Documented here as a decision, not an oversight.

Commands run:

```
$ DATABASE_URL="postgresql://user:pass@localhost:5432/placeholder" npx prisma validate
The schema at prisma/schema.prisma is valid 🚀
```

(`validate` only checks schema syntax/relations; no DB connection was made or needed.)

## Update — migration generated, applied, and verified (2026-10-12)

Re-provisioned a disposable Postgres (`initdb`/`pg_ctl` at `/tmp/dexpg`, unix socket, port 5433
to dodge the earlier 103-byte socket-path limit — same recipe as Task4/5, `dangerouslyDisableSandbox`
required for `initdb`'s shared-memory segment, same sandbox wall as before).

```
$ npx prisma migrate dev --name add_action_provenance --skip-generate
Applying migration `20261012182805_add_action_provenance`
Your database is now in sync with your schema.
```

Reviewed `prisma/migrations/20261012182805_add_action_provenance/migration.sql`: additive only
(2 `CREATE TYPE`, 2 `CREATE TABLE`, 5 `CREATE INDEX`, 5 `ADD FOREIGN KEY`), no `DROP`/`ALTER
COLUMN` touching any existing table. All three new FKs (`ActionProvenance` → Customer/Website/
Action, `ActionProvenanceFinding` → ActionProvenance/Finding) are `ON DELETE RESTRICT` — matches
the plan's "avoid cascades that silently erase evidence" instruction exactly.

```
$ npx prisma generate            # Prisma Client regenerated clean
$ npx tsc --noEmit                # clean, no errors
$ npx vitest run                  # 131 files, 1242 passed / 12 skipped, 0 failed, 0 regressions
$ npm run build                   # prerender fails on /dashboard-preview, /dashboard, /, /review,
                                   # /settings, /studio -- confirmed PRE-EXISTING on main (same
                                   # failures, same useContext-null error, before this branch's
                                   # changes existed) via `git checkout main && npm run build`.
                                   # Not caused by this schema change; not fixed here, out of scope.
```

## What's explicitly NOT done yet

- **Gate 4 (producer evidence capture)** — none of the six producers in
  `generation-dispatch.ts` pass Finding IDs or input snapshots yet. This is real, multi-file
  work, not wiring that already half-exists.
- **Gate 5 (persist atomically)** — `generation-worker.ts`'s success transaction does not yet
  write an `ActionProvenance` row.
- **Gate 6 (reader scope / write controls)** — no runtime DB role change, no cross-tenant test
  coverage yet.
- **Gate 7 (claims)** — no UI/API surfacing.

## Why this stops here rather than continuing straight through

Gates 4-6 touch six separate producer functions plus the worker's success transaction plus
tenant-isolation test coverage — the same category of auth/schema/money-adjacent work my own
standing review rule says to flag rather than solo-rush. Doing it carefully (one producer at a
time, tested against a live disposable DB, not guessed) is real multi-step work that benefits
from its own focused pass rather than being compressed into the tail of an unrelated session.
Reporting this checkpoint now rather than pushing through under context/time pressure.
