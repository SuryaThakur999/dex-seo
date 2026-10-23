# ADR: Durable Job Architecture — Generation Workflow (Phase 1C)

**Status:** Accepted — scope confirmed by the account owner 2026-09-29 (recommended option: run-scan.ts's 6 actionTypes + retry-draft only; Content Studio/dashboard-insight/feedback-analysis/preference-candidates explicitly out of scope, named as a separate future decision)
**Date:** 2026-09-28
**Owner:** Agent A (this session)
**Template used:** `docs/superpowers/specs/templates/durable-job-architecture-decision-template.md`
**Precedent:** `docs/superpowers/specs/2026-09-24-phase1b-scan-queue-adr.md` (Phase 1B, scan workflow — read first, this ADR extends it rather than re-deriving from scratch)

## Context

Every real generation call in this codebase today runs synchronously, inline, inside whatever request triggered it, with no persisted job record, no persisted retry schedule, and no circuit breaker. `src/lib/openai-client.ts`'s own comment already names this as a known, deliberately-deferred gap: *"No queue, no circuit breaker: this codebase runs on stateless Vercel functions with no shared in-memory or persisted state between invocations, so a real circuit breaker needs its own storage decision — correctly out of scope here, still the master brief's deferred 'Phase 9' unit."*

**Full inventory of real generation call sites, confirmed by direct inspection:**

| Call site | Caller | Trigger | Today's retry | Today's idempotency | Today's failure UX |
|---|---|---|---|---|---|
| `creation-engine.ts` (`draftMetaDescription`) | `run-scan.ts` per-page loop; `retry-draft/route.ts` | Background (inside a ScanJob) or manual retry click | SDK `maxRetries: 2` only, in-process | `Action` row dedup: `alreadyPending`(succeeded)/`failedExisting`(failed, retry-in-place) | `generationStatus: 'failed'` + customer-safe error string on the Action row |
| `restricted-wording-fix.ts` | same as above | same | same | same pattern | same |
| `internal-link-fix.ts` | `run-scan.ts` only — retry-draft explicitly **rejects** retry for this type (Phase 1F, `f4df8b1`) since it needs the full page inventory retry-draft can't reconstruct | Background only | SDK retries only | same Action dedup pattern | same, but no manual retry path exists yet |
| `deterministic-remediation.ts` (canonical_fix/structured_data_fix/entity_markup_fix) | `run-scan.ts` only | Background | N/A — no LLM call, can't fail this way | same Action dedup pattern | N/A (deterministic, doesn't fail like a provider call) |
| `content-studio/draft-generator.ts` | `generate-and-validate.ts`, called from a Studio API route the user is actively waiting on | **Synchronous, user-facing** — customer clicks "Generate," waits for the HTTP response | SDK `maxRetries: 2` only | None — a failure just returns an error to the browser; no persisted retry state, no dedup | Immediate error shown to the user, must manually resubmit |
| `dashboard-insight.ts` | Dashboard page render | Synchronous, server-rendered | SDK retries only | N/A | Already has a real fallback (`fallbackInsight`) — a failure is invisible to the customer, no error state at all |
| `feedback-analysis.ts` / `preference-candidates.ts` | On-demand API routes (`/api/websites/[id]/feedback-analysis`, `/api/websites/[id]/preference-candidates/check`) | Synchronous, user- or cron-triggered on demand | SDK retries only | None | Route-level error response |

**Real gap this closes:** for the 6 actionTypes generated inside `run-scan.ts` (the majority of generation volume, and the only ones running unattended inside a background ScanJob), a transient provider failure or a process death between "provider call succeeded" and "Action row written" is currently unrecoverable except by a customer manually clicking retry (5 of 6 types) or the *next full scan* re-discovering the same Finding (all 6, since Finding creation is unconditional and re-derives from live page content each scan — this already provides a coarse, un-scheduled retry, just with no backoff, no attempt cap, and no circuit breaker to stop hammering a genuinely down provider).

**Real current volume** (same production data Phase 1B's ADR used, this session's actual work confirms no material change): pilot-stage, single provider (Groq, via the OpenAI SDK's `baseURL` override per ADR 0006), ~5 scans/day, each scan generating at most `MAX_DRAFTS_PER_SCAN = 30` LLM-backed actions. This is not a throughput problem — same conclusion Phase 1B reached.

## Constraint check

- [x] Vercel-serverless-only is **not** assumed as a hard constraint.
- [x] "Buy is better" is **not** assumed by default.
- [x] No new external service, account, or credential is proposed — QStash is already live in production (Phase 1B), already has real signing keys configured, and the sweep pattern it established is directly reusable.

## Options considered

The queue-*mechanism* question is identical to Phase 1B's (same volume, same platform, same team-of-one operational constraint) — re-litigating it in a fresh table would ignore real, already-gathered evidence. Phase 1B's own table (see that ADR) stands; summarized conclusion re-applied here: Inngest and a standalone worker both solve problems this app doesn't have (workflow orchestration at scale, infra ownership) at a real cost (new vendor lock-in, a second service to operate) unjustified at ~5 scans/day × ≤30 generations/scan. Extending the existing Postgres + QStash pattern remains correct for the *same* reasons, not re-derived from scratch.

**What genuinely is new and needs its own design** (Phase 1B's ADR explicitly deferred this): the generation job's own state machine, its idempotency-key strategy (Phase 1B's scan jobs don't need one — a customer can only have one active scan per website by construction; generation jobs need one per real downstream artifact), and the persisted circuit breaker (Phase 1B had none — the scan path has no external-provider dependency at all).

## Decision

**Extend the existing Postgres pattern with a new `GenerationJob` table (mirroring `ScanJob`'s proven shape, not reusing `Action` directly) plus a new `ProviderCircuitBreaker` table, swept by a new QStash schedule calling a new `/api/generation/process` endpoint** — same dual-auth pattern (`CRON_SECRET` bearer OR QStash signature) `/api/scan/process` already uses, same atomic-claim pattern (`updateMany({where: {status: 'queued'}, ...})`) `claimAndRunScanJob` already uses.

**Why a new `GenerationJob` table, not fields bolted onto `Action`:** `Action` is a *decision* artifact — it only exists today once generation has already succeeded or failed, and its whole downstream lifecycle (approve/reject/edit, ProofLayer result, evidence export) assumes a real row means real content exists. Making `Action` rows exist in a pre-generation "queued" state would force every consumer of `Action` (the review UI's `canApprove` guard, the Opportunity Board's grouping, evidence-pdf export) to additionally handle a "this row has no content yet" state they were never designed for. A separate job table — exactly `ScanJob`'s relationship to the scan it represents — keeps `Action` meaning what it already means, and is the literal "reuse existing architecture" answer Phase 1B already validated for the same reason.

## Scope — the one unresolved product decision, raised per this session's own instruction to stop for one

Applying persistent queueing to *every* generation call site uniformly is not one decision, it's several, because the call sites split cleanly by UX contract:

- **In scope for this slice** — the 6 `run-scan.ts` actionTypes (`meta_description`, `canonical_fix`, `structured_data_fix`, `entity_markup_fix`, `restricted_wording_fix`, `internal_link_fix`) and `retry-draft`'s manual retry. All are already background or already an explicit "try again" action — queueing them is a pure reliability improvement with **no UX redesign**: a scan already shows "Drafting a fix for {url}..." log lines the customer doesn't watch in real time, and retry-draft already redirects immediately without a live result. Adding "Queued"/"Waiting to retry"/"Rate limited"/"Blocked" as real, visible states here is additive, not disruptive.
- **Out of scope, named not hidden** — `content-studio/draft-generator.ts` is synchronous with a customer actively watching the Studio page for a result *right now*. Converting it to "enqueue → poll → show result" is a real frontend redesign (a spinner becomes a polling state machine), which this session's own IMPLEMENTATION RULES explicitly forbid folding into a backend reliability slice ("Do not make unrelated UI or architecture changes"). `dashboard-insight.ts` already degrades gracefully (real fallback text, no visible failure) and doesn't need a queue to be safe. `feedback-analysis.ts`/`preference-candidates.ts` are low-volume, on-demand, non-critical paths with no reported reliability problem.

This ADR and the implementation that follows it cover the in-scope set only. The out-of-scope set is a named, tracked follow-up, not a silent gap.

## State machine

`GenerationJob.status` (internal) maps to the 8 required customer-facing states almost 1:1:

| Internal status | Customer label | Meaning |
|---|---|---|
| `queued` | Queued | Row created, not yet claimed |
| `running` | Running | Claimed, provider call in flight |
| `waiting_retry` | Waiting to retry | A retryable failure occurred; `nextRetryAt` set, will be re-claimed after that time |
| `rate_limited` | Rate limited | Provider returned 429; `nextRetryAt` set from `Retry-After` when the provider supplies it, else a fixed backoff |
| `blocked` | Blocked | The shared circuit breaker for this provider+model is open; job stays here until the breaker allows a probe |
| `completed` | Completed | Provider call succeeded and the downstream `Action`/`ContentPiece` row was written in the same transaction |
| `failed` | Failed | Attempt cap reached, or a classified-permanent error (not retryable) |
| `cancelled` | Cancelled | `cancelRequested` observed before completion — same polling-flag pattern `ScanJob.cancelRequested` already uses |

Transitions: `queued → running → (completed | waiting_retry | rate_limited | blocked | failed | cancelled)`; `waiting_retry`/`rate_limited`/`blocked` → `running` on the next eligible sweep tick (`nextRetryAt <= now()`, breaker no longer open); any pre-`completed` state → `cancelled` on a cancel request observed at claim time.

## Idempotency strategy

`GenerationJob.idempotencyKey` (`@unique`) = a deterministic hash of `(customerId, websiteId, actionType, targetRef, inputFingerprint)`, where `targetRef` is the `pageUrl` for every `run-scan.ts` actionType and `inputFingerprint` is the same `computeContentHash`-style hash `run-scan.ts` already uses for meta_description's content-drift check, generalized to cover each generator's real inputs (e.g. canonical_fix's key input is just the pageUrl itself, since its output is always identical for a given URL; restricted_wording_fix's fingerprint includes the matched phrases). Enqueueing is `db.generationJob.upsert` keyed on `idempotencyKey` — a duplicate submission (double page-load, concurrent tab, a retried HTTP request) is a no-op against the same row, not a second job. The job's own completion writes the downstream `Action` row **inside the same transaction** that marks the job `completed`, so a retried sweep tick that finds the job already `completed` never re-runs generation or double-writes an `Action` — this is the same guarantee `claimAndRunScanJob`'s `updateMany({where: {status: 'queued'}}))` claim already provides for scans, extended to also cover the *downstream artifact* write, which Phase 1B's scan-level idempotency didn't need to reason about (a scan doesn't itself "produce" one artifact the way one generation job produces one Action).

## Persisted circuit breaker

New `ProviderCircuitBreaker` table, keyed by `(provider, model)` — **not** per-tenant. A provider outage is a shared external fact, not a per-tenant one; scoping the breaker per-tenant would mean every tenant independently rediscovers the same outage before any of them stop hammering a dead provider, which is worse isolation, not better. This directly satisfies the requirement to avoid one tenant blocking unrelated tenants: the breaker only ever blocks calls to a specific *provider+model*, and every tenant's jobs against that same provider+model are equally, correctly paused — there is no cross-tenant leakage of any kind because no tenant-specific data is ever stored on this table.

No existing thresholds exist anywhere in this codebase to recover — these are new and must be justified from real volume:

- **Open after 5 consecutive failures** for the same `(provider, model)` within a 10-minute window. Chosen because the SDK's own `maxRetries: 2` already absorbs a single flaky call before a `GenerationJob` attempt is even marked failed — 5 *job-level* failures in a row is a strong, fast signal of real provider trouble at this volume (a normal day sees at most 30 generation attempts total), not a false trip on ordinary noise.
- **Cooldown 5 minutes**, then one **half-open probe**: the next eligible job is allowed to attempt generation; success closes the breaker (`consecutiveFailures` reset to 0); failure reopens it and doubles the cooldown, capped at 30 minutes, so a genuinely extended outage doesn't cause a tight retry loop against a provider that's still down.
- Every other job queued behind an open breaker moves straight to `blocked` at claim time (checked before the provider call, not after) rather than each independently attempting and failing — this is what actually prevents "repeated calls to a failing provider," not just labels the failures after the fact.

## Worker recovery

Same stale-reaper pattern `/api/scan/process` already uses: any `GenerationJob` stuck in `running` longer than its expected generation latency (a single LLM call — a much tighter bound than a whole scan's 10-minute `STALE_RUNNING_MINUTES`; proposed 2 minutes, since every real generator call in this codebase already completes in low single-digit seconds) is reaped back to `waiting_retry` with attempt count incremented, on every sweep tick, before claiming new work — covering exactly the "process stopped between provider completion and local persistence" case named in the requirements: if the provider call itself succeeded but the process died before the completion transaction committed, the reaper's re-claim re-runs generation once more (safe, since nothing was ever persisted) rather than leaving the job silently stuck.

## Migration and rollback implications

**Migration:** two new tables (`GenerationJob`, `ProviderCircuitBreaker`), additive only — no existing table altered, no backfill required (historical `Action` rows have no corresponding `GenerationJob` and don't need one; the new flow applies only to newly-enqueued generation going forward). Same safe-migration path every prior schema change this project has used: a fresh isolated Neon dev branch, `prisma migrate dev` there, review the generated SQL is additive-only, then `prisma migrate deploy` against real prod, dev branch deleted after.

**Rollback:** if this proves wrong in production, `run-scan.ts`'s generation call sites can revert to calling each generator directly and inline (exactly today's code, since this slice doesn't delete or replace the existing generator functions — it wraps their *invocation*, not their implementation) — no data migration needs undoing, since `GenerationJob`/`ProviderCircuitBreaker` are purely additive and can simply stop being written to.

## Validation before finalizing

- [x] Every real generation call site inventoried from direct inspection, not assumed
- [x] "Extend what we have" fully evaluated and selected, consistent with Phase 1B, not re-litigated from zero
- [x] Idempotency strategy defined against this workflow's actual shape (one job → one artifact), not copied unchanged from the scan ADR where it didn't apply the same way
- [x] Circuit breaker thresholds stated with justification from real volume, since no existing thresholds were found to recover
- [x] Scope boundary stated explicitly as a product decision, not silently assumed — **confirmed by the account owner 2026-09-29**, recommended option selected
- [x] Committed to the repository — this file.
