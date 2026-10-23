# ActionProvenance — gate 6 redesign: append-only triggers (for Pam)

Short pattern note, same format as the gates 4-5 wiring note. Supersedes the role-grant approach
in `prisma/ops/2026-10-12-action-provenance-runtime-role.sql` (deleted) and
`docs/superpowers/evidence/2026-10-12-action-provenance-gate6.md` (marked superseded, kept for
the record). Human directive, 2026-10-12: no prod DB access, ever -- a new DB role can never
actually be provisioned or wired into the app's single `DATABASE_URL` connection, so the
role-grant mechanism never enforced anything. **Priority: below your critical path (2D Task 5-6,
then 2F S1). Pick this up after, not before.**

## What to build

A `BEFORE UPDATE OR DELETE` trigger on `ActionProvenance` and `ActionProvenanceFinding` that
raises an exception, unconditionally. This enforces append-only for *any* connecting role --
the app's existing single DB user included -- with no new credential, no connection-string
change, and no app code trusting itself. It's the DB-level enforcement the plan
(`docs/superpowers/plans/2026-10-11-action-provenance.md`) always wanted; the role-grant attempt
was the wrong mechanism for getting there, not the wrong goal.

### Migration

Prisma's schema DSL has no trigger primitive, so this is a hand-written (or
`prisma migrate dev --create-only` then hand-edited) additive migration:

```sql
CREATE OR REPLACE FUNCTION action_provenance_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ActionProvenance and ActionProvenanceFinding are append-only; % on % is not permitted', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER action_provenance_no_update_delete
  BEFORE UPDATE OR DELETE ON "ActionProvenance"
  FOR EACH ROW EXECUTE FUNCTION action_provenance_append_only();

CREATE TRIGGER action_provenance_finding_no_update_delete
  BEFORE UPDATE OR DELETE ON "ActionProvenanceFinding"
  FOR EACH ROW EXECUTE FUNCTION action_provenance_append_only();
```

No `DROP TRIGGER`/`DROP FUNCTION` needed in this migration -- it's additive, same as the
original `add_action_provenance` migration. (A later migration that needs to touch these tables
structurally, e.g. adding a column, is unaffected -- `ALTER TABLE` isn't `UPDATE`/`DELETE` on
rows and doesn't fire this trigger.)

### Test (extend or replace the deleted action-provenance-role.integration.test.ts)

Same disposable-DB harness pattern as `action-provenance.integration.test.ts` -- no new role,
just the normal test connection used everywhere else in this repo:

- `INSERT` and `SELECT` against `ActionProvenance`/`ActionProvenanceFinding` succeed, unchanged.
- `UPDATE`/`DELETE` against either table raise and fail with the trigger's own message (assert
  on the exception, e.g. `rejects.toThrow(/append-only/i)`), proving the database itself refuses
  it -- not an app-layer check that could be bypassed by a bug elsewhere.
- Confirm the trigger doesn't block a legitimate `INSERT ... ON CONFLICT DO NOTHING` if any code
  path ever uses one (none does today, but worth a quick check since `ON CONFLICT` touching the
  `DO UPDATE` variant would be blocked -- and should be, since this table has no upsert path).

## What this does NOT change

- Retention (gate 2, already closed) and read-authorization (gate 7, still unbuilt, documented
  in the superseded evidence doc) are unaffected by this redesign.
- `ActionProvenance.customerId`/`websiteId` tenant-consistency checks inside
  `generation-worker.ts`'s transaction (gates 4-5, already built and merged) are unaffected --
  this trigger only stops post-insert mutation, it doesn't touch the write path itself.

## Rollout

The migration lands in the repo and gets reviewed/tested on the disposable DB like any other
change here. It does **not** get run against production by anyone on this team -- human
directive is no prod DB access, full stop. The real `prisma migrate deploy` against production
happens at the Phase 2 release, run by the human directly, immediately before the prod promote.
Mark this gate "built and proven on the disposable test DB, not applied to prod" until that
happens -- don't claim it's enforced in production before it actually is.

## Handoff

Dwight (me) does the schema-lane review once you've built this -- same split as gates 4-5
(Ryan reviewed those; this one's squarely schema/DB-enforcement territory, my usual lane).
