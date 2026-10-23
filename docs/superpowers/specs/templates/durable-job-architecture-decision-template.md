# ADR: Durable Job Architecture for [scan | generation] Workflows

Fill this in during Phase 1B (scan path) and reuse for Phase 1C (generation path) as a separate ADR if the answer differs. Do not implement before this is filled in and reviewed.

**Status:** Proposed | Accepted | Superseded
**Date:**
**Owner:** Agent A

## Context

What breaks today without a durable job? (Cite the exact current behavior — e.g. "`/api/scan` runs the crawl inline within one request, `maxDuration=300`; a dropped browser connection loses in-progress work except for what `/api/scan/process`'s cron sweep happens to catch.") What real production volume/frequency does this need to handle right now, not hypothetically?

## Constraint check

- [ ] Vercel-serverless-only is **not** assumed as a hard constraint — the account owner has authorized buying a domain for a small always-on worker if that's genuinely the smallest fit.
- [ ] "Buy is better" is **not** assumed by default — recommend the smallest architecture that meets the acceptance requirements below, even if that's extending the existing Postgres+cron pattern.

## Options considered

Evaluate at minimum these four, plus any other already-installed system that's a demonstrable fit:

| Option | Durable delivery | At-least-once | Idempotency fit | `Retry-After` support | Long-running work | Vercel compat | Request signing | Local dev story | Observability | Cancellation | Data residency | Cost @ current volume | Cost @ pilot volume | Vendor lock-in | Migration effort | Operational burden | Recovery behavior |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. Extend existing Postgres + cron | | | | | | | | | | | | | | | | | |
| 2. Inngest | | | | | | | | | | | | | | | | | |
| 3. Upstash QStash | | | | | | | | | | | | | | | | | |
| 4. Small always-on worker on own domain | | | | | | | | | | | | | | | | | |
| 5. [other, if genuinely relevant] | | | | | | | | | | | | | | | | | |

## Decision

Chosen option and the one-sentence reason it beat the others on the acceptance requirements (not on general appeal).

## Consequences

What becomes easier? What becomes harder? What's the rollback if this turns out wrong in production?

## Validation before finalizing

- [ ] Every option's row is filled from evidence (docs, current codebase, or a real spike) — not left blank or guessed
- [ ] At least one "extend what we have" option is fully evaluated, not skipped
- [ ] The chosen option's `Retry-After`/idempotency/cancellation behavior is confirmed against the acceptance criteria in the relevant slice (1B or 1C), not assumed
- [ ] Committed to the repository, linked from the slice's implementation notes
