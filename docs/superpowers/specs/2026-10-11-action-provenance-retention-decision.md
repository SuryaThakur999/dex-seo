# ActionProvenance — gate 2 retention/access-control decision

Resolves gate 2 of `docs/superpowers/plans/2026-10-11-action-provenance.md`. Human delegated this decision 2026-10-11 ("continue and get the right decision done") rather than naming new policy — the decision below applies dex-ai's existing, already-established pattern rather than inventing one.

## What already governs every other table

`docs/superpowers/specs/2026-10-02-impressum-privacy-draft.md` section 1.5 states the current, real behavior of this codebase: no job purges `PageSnapshot`, `ScanLogLine`, `AuditLogEntry`, or `Action` rows. Nothing auto-deletes. The only existing deletion path is the Shopify `shop-redact` webhook (account-level). The *legal retention period* (how long data may/must be kept) is explicitly left as a founder/counsel placeholder on that same doc — pending real legal review, tracked separately on `dex-legal-compliance-gaps` / `dex-impressum-privacy-draft`. This decision does not touch that placeholder or invent a number.

## Decision: ActionProvenance follows the identical pattern

| Gate 2 item | Decision | Basis |
|---|---|---|
| Retention/lifecycle duration | No automatic expiry. Rows persist indefinitely, same as every other table. | Consistency with existing codebase-wide invariant, not a new policy |
| Deletion/export policy | Deleted only via the existing account-deletion path (same mechanism `shop-redact` already uses at the account level). No standalone per-row deletion UI or job. | Matches existing single deletion mechanism; avoids a new tamper/delete surface the plan's own security section warns against |
| Backup treatment | Included in backups like every other table — no special exclusion or inclusion rule. | No existing infra separates backups per table; inventing one here would be a new, uncosted requirement |
| Purge authority | None beyond account deletion. No agent, role, or job may delete or purge ActionProvenance rows outside that path. | Plan's own security section already warns against describing this as WORM/tamper-proof — the simplest way to avoid overclaiming is to not build a purge path at all until the legal retention period is actually set |
| Runtime DB role | `SELECT` + `INSERT` only, no `UPDATE`/`DELETE` — exactly as the plan already recommended. | Plan's own recommendation, confirmed sound by Dwight's 21:30 review |
| Migration DB role | Separate from runtime credentials, scoped to the one-time additive migration only. | Plan's own recommendation |
| Enforcement level | Hard DB-role constraint (no `UPDATE`/`DELETE` grant), not application-layer-only. | Plan's own recommendation; matches Task4's precedent (DB-level enforcement, not app-trust) |

## What this does NOT decide

The actual legal retention *period* (e.g. "90 days," "until contract end") stays an open founder/counsel decision tracked on `dex-impressum-privacy-draft` / `dex-legal-compliance-gaps`. When that's set, it applies to ActionProvenance the same as every other table — no separate carve-out is being created here. If the founder later picks a bounded retention period, implementing the purge job at that point is new scoped work, not something this decision pre-authorizes.

## Result

Gate 2 is closed. Gate 1 (preflight refresh) is Dwight's to confirm separately. Gate 3 (schema/migration review) was already CLEAN per Dwight's 2026-10-11T21:30Z review. Migration may proceed once Dwight confirms gate 1.
