# ADR: Durable Job Architecture — Scan Workflow (Phase 1B)

**Status:** Accepted
**Date:** 2026-09-24
**Owner:** Agent A (this session)
**Template used:** `docs/superpowers/specs/templates/durable-job-architecture-decision-template.md`

## Context

Today `/api/scan`'s `POST` handler runs the entire crawl inline within one request (`maxDuration = 300`). If the browser disconnects or the function is killed mid-crawl, the only safety net is `/api/scan/process`'s cron sweep — and that cron runs **once per day** (`vercel.json`: `"0 7 * * *"`), not frequently. A job that dies mid-request can sit in `queued`/`running` state for up to 24 hours before anything notices.

**Real current volume** (queried directly against production, 2026-09-24): 144 `ScanJob` rows total, ever. 4 distinct customers have ever triggered a scan. 33 scans in the last 7 days (~4.7/day). 14 `Website` rows, 229 `Action` rows. 16 failed scans all-time (~11% failure rate). This is genuinely pilot-stage volume, not a scale problem — the reliability gap is the daily-cron blind spot, not throughput.

**Likely constraint:** both existing crons (`measure-outcomes`, `scan/process`) are configured at once-daily frequency, consistent with Vercel's Hobby-tier limit of one cron run per day per project (Pro tier allows any frequency). Not independently confirmed via the Vercel dashboard — flagged as "likely," not fact.

## Constraint check

- [x] Vercel-serverless-only is **not** assumed as a hard constraint — noted, but at ~5 scans/day, a small always-on worker or a paid queue service would be solving a scale problem this app doesn't have.
- [x] "Buy is better" is **not** assumed by default — see Decision below.

## Options considered

| Option | Durable delivery | At-least-once | Idempotency fit | `Retry-After` support | Long-running work | Vercel compat | Request signing | Local dev story | Observability | Cancellation | Data residency | Cost @ current volume (~5/day) | Cost @ 10x pilot volume (~50/day) | Vendor lock-in | Migration effort | Operational burden | Recovery behavior |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **1. Extend Postgres + cron** | Yes — `ScanJob` row is the durable record already | Yes, with idempotent claim (`UPDATE ... WHERE status='queued'` pattern already used for the preference-check TOCTOU fix) | Excellent — same DB, same transaction as the rest of the app | N/A (this is the scan path, not the LLM path — 1C's problem) | Fine, splits work into resumable checkpoints instead of one long request | Native, zero new integration | N/A, internal only | Identical to today — no new local setup | Already have `ScanLogLine` | Already exists (`cancelRequested` flag) | Stays in existing Postgres, no new data leaves the stack | $0 marginal | $0 marginal | None — it's the DB we already run | Low — extend existing model, no new service account/API keys | Low — one system to operate, already operated | Resume from last recorded checkpoint stage |
| **2. Inngest** | Yes, by design | Yes | Good, built-in dedup keys | Yes, native | Yes, designed for this | Yes, has a Next.js adapter | Yes, signs webhooks | Needs the Inngest Dev Server running locally | Good, built-in dashboard | Yes | Data passes through Inngest's cloud | Free tier likely covers this volume | Free tier likely still covers 50/day | Real — workflow logic lives in their SDK/format | Medium — rewrite the scan loop as Inngest steps | New service to monitor, new failure mode to learn | Inngest's own retry/replay UI |
| **3. Upstash QStash** | Yes, as a scheduler/retrier, not a full workflow engine | Yes | Manual — QStash gives you retries, not app-level dedup | Yes, respects `Retry-After` on the target | No — it calls your endpoint, doesn't run long jobs itself | Yes, HTTP-based | Yes, signs requests | Works locally via HTTP, no special dev mode | Basic — delivery logs only | Manual, via your own endpoint logic | Passes through Upstash | Free tier covers this trivially | Free tier still covers 50/day | Low — it's just a scheduled HTTP caller | Low — could literally just replace the daily `vercel.json` cron entry with a QStash schedule hitting the same `/api/scan/process` endpoint more often | Low | Whatever the target endpoint does with the retry |
| **4. Small always-on worker on own domain** | Yes | Yes | Depends entirely on what's built | N/A | Yes | N/A, separate host | Would need to build | Simplest possible — it's just a long-running Node process | Would need to build | Would need to build | New infra, new domain, new TLS cert to manage | Cheapest VPS (~$5-6/mo) | Same | None beyond hosting | High — new deploy pipeline, new monitoring, new on-call surface for a solo founder | High — a second thing to keep alive, patch, and watch | Whatever's built |

## Decision

**Extend the existing Postgres + cron pattern (Option 1), with one addition: replace the once-daily Vercel cron with Upstash QStash calling `/api/scan/process` every 1-2 minutes** (Option 3, but scoped narrowly to *scheduling*, not as a job-queue replacement). This is the smallest change that actually closes the real gap: at 4.7 scans/day and an 11% historical failure rate, there is no throughput problem to solve — there's a 24-hour detection-latency problem, and a more frequent trigger for the exact sweep logic that already exists fixes it directly. Inngest and a standalone worker both solve problems this app doesn't have yet (workflow orchestration at scale, infra ownership) at real cost (new SDK/vendor lock-in for Inngest, a second service to operate for the worker) that isn't justified by 5 scans/day.

## Consequences

**Easier:** a stuck/crashed job is caught within ~2 minutes instead of up to 24 hours — the resumption acceptance criterion becomes trivially satisfiable with the sweep logic that already exists, just triggered more often. No new SDK, no new data leaving Postgres, nothing new to learn operationally.
**Harder:** nothing meaningfully — QStash is one new (free-tier) account and one schedule config, not a new architecture.
**Rollback:** if QStash's free tier or reliability ever becomes a real problem, reverting to the existing `vercel.json` cron entry (just at a shorter interval, if upgraded to Vercel Pro) is a one-line change — no data model or job-state changes need to be undone, since the job-state machine itself never changes in this decision.
**Revisit trigger:** if volume grows past roughly 10x current (~50 scans/day) or multiple concurrent long-running scans become common, re-open this ADR — that's the point where Inngest's actual workflow features (step functions, concurrency control, built-in observability) start earning their cost.

## Validation before finalizing

- [x] Every option's row filled from evidence (real ScanJob/Website/Action counts queried from production, real `vercel.json` cron config read, each vendor's real feature set)
- [x] "Extend what we have" fully evaluated, not skipped — and selected
- [x] Idempotency: already covered by the existing `cancelRequested`-flag/status-transition pattern; QStash's own at-least-once delivery to `/api/scan/process` doesn't change this since that endpoint's job-claiming logic must already be idempotent for the existing daily cron to be safe
- [x] Committed to the repository — this file. Linked from Phase 1B's implementation notes when that slice starts.
