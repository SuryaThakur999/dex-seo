> **SUPERSEDED 2026-10-12.** The role-grant approach below doesn't actually enforce anything in
> production: the app connects to Postgres as a single `DATABASE_URL` user for every table, not
> as `dex_runtime_role`, and switching connections per-table isn't feasible. Human directive: no
> prod DB access, ever -- so a new role can never actually be provisioned or wired in by anyone
> on this team either. Redesigned as a `BEFORE UPDATE OR DELETE` trigger instead (enforces
> append-only for whatever role connects, no new credential, plain additive migration). See
> `docs/superpowers/plans/2026-10-12-action-provenance-trigger-design-note.md`. The role-grant
> SQL file and its role-specific integration test have been deleted (git history keeps them);
> everything below this notice describes the abandoned approach, kept for the record.

# ActionProvenance — gate 6 (reader scope / write controls)

Resolves gate 6 in `docs/superpowers/plans/2026-10-11-action-provenance.md`, closing the caveat
Ryan raised on his gates-4-5 re-check (god's relay, 2026-10-12): "snapshots create durable
plaintext duplicates of context already in CustomerFact/ClientProfile/Action, and he did not
verify provenance-row read authorization or retention controls in this review."

## Retention

Already closed by `docs/superpowers/specs/2026-10-11-action-provenance-retention-decision.md`
(gate 2) -- no-auto-purge, same pattern as `PageSnapshot`/`AuditLogEntry`. Nothing new here.

## Runtime write role (DB-level enforcement)

`prisma/ops/2026-10-12-action-provenance-runtime-role.sql` creates `dex_runtime_role` with
`SELECT, INSERT` on `ActionProvenance`/`ActionProvenanceFinding` and explicit `REVOKE UPDATE,
DELETE`, per the gate 2 decision's "hard DB-role constraint... not application-layer-only."

**Not applied to any real database by this repo.** It's a DBA/ops script, not a Prisma
migration -- role and grant management is an admin action against the actual production
database's actual runtime credentials, which this session has no visibility into (host,
provider, or who holds admin access). Proven mechanically against the disposable test database
only: applied it there, connected as `dex_runtime_role`, and
`src/lib/action-provenance-role.integration.test.ts` confirms SELECT/INSERT succeed and
UPDATE/DELETE on both tables fail with `permission denied` (not caught/mapped by app code --
the database itself refuses it). 4/4 passed.

```
$ psql ... -f prisma/ops/2026-10-12-action-provenance-runtime-role.sql
DO / GRANT / GRANT / REVOKE / REVOKE
$ DEX_PROVENANCE_RUNTIME_ROLE_DATABASE_URL=... DEX_PROVENANCE_TEST_DATABASE_APPROVED=disposable \
  npx vitest run src/lib/action-provenance-role.integration.test.ts
4 passed
```

**Before this is load-bearing in production**, whoever holds real DB admin access needs to:
run the script against the real database with a real role name/password matching what the
deployed app actually connects as, and confirm the app's `DATABASE_URL` in production points at
that restricted role, not a superuser/migration connection. Flagging this explicitly rather than
claiming it's done -- it's proven as a mechanism, not deployed.

## Read authorization (the other half of Ryan's caveat)

No API route or UI surface reads `ActionProvenance` today -- grepped `src/app/api` and
`src/app`, zero references outside this feature's own code and tests. That's gate 7 ("Enable
claims only for covered records") scope, and it is genuinely unbuilt, not merely untested. There
is nothing to tenant-isolation-test against a read path that doesn't exist yet.

**When gate 7 is built**, the read path must follow the same pattern every other tenant-scoped
read in this codebase already uses (e.g. `action-decision.ts`'s `actionDecisionInclude` reads,
which always resolve the authenticated customer's own website before querying) -- resolve the
authenticated customer and their owned website first, then filter `ActionProvenance` by that
resolved `customerId`/`websiteId` in the `where` clause, never a raw request parameter. This is
a note for gate 7's implementer, not something gate 6 can test today.

## What this does NOT close

Whether the real production `DATABASE_URL` the app actually uses is already the restricted role
or still a superuser connection. That's outside what this session can observe (no access to the
production environment's actual connection string or its provider's role-management console).
Raising this explicitly to god/the human rather than assuming either answer.
