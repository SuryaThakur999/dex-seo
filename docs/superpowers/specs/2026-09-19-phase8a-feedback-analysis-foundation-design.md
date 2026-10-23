# Phase 8A — Feedback-Analysis Foundation (design)

Brainstormed 2026-09-19, continuing Milestone E ("controlled learning") after its first slice (`f3fd260`, customer-editable brand/content preferences — write-side only, zero read side). Per the master brief's own Remaining list: the `AuditLogEntry` feedback-analysis surface has to exist before preference inference can be built on anything real.

## What this is, precisely

Dex already records every approve/reject/edit decision to `AuditLogEntry` (`eventType: 'action_decided'`, `detail: { decision, pageUrl, originalDraftContent? }`), scoped per `Action` → `Website`. Nothing reads it back. This phase adds a read surface: real counts (always live) plus an on-demand, cached AI summary of recurring edit patterns.

**This is not self-learning.** No inferred preference is stored, promoted, or applied to future generation automatically. That is explicitly a separate, later Phase 8 unit (candidate inference → holdout evaluation → human approval → versioned promotion → rollback) — not started here, not implied as "coming for free" by this work.

**Accurate completion statement to use once shipped:**

> Dex exposes tenant-scoped approval, rejection and edit history in Analytics and can generate a cached, provenance-aware summary of repeated edit patterns. No inferred preference is automatically promoted or applied.

## Architecture

New `src/lib/feedback-analysis.ts`, mirroring the existing `src/lib/dashboard-insight.ts` pattern (same model, same honest-fallback discipline, same dependency-injectable LLM caller for testing):

- `computeDecisionBreakdown(entries, actions)` — pure function. Groups `action_decided` entries by `actionType` (joined via `Action.actionType`) and by decision (`approved`/`rejected`/`edited`). Real counts, no LLM, recomputed fresh on every page load — cheap DB aggregation, never cached.
- `buildFeedbackSummaryPrompt(edits)` — builds the LLM prompt from a minimized edit list: for each edit, only `actionType`, `decision`, `timestamp`, and the before/after text pair (`originalDraftContent` vs the current `Action.draftContent`). No `ClientProfile` brand data, no customer identity, nothing beyond what describes the edit itself. Explicit no-invent instruction, same wording style as `dashboard-insight.ts`'s prompt.
- `generateFeedbackSummary(edits, callOpenAI?)` — calls the LLM (same `MODEL = 'openai/gpt-oss-120b'`, same `openai` client construction as every other generation call site), honest fallback string on empty/error response, never throws.
- `MIN_EDITS_FOR_SUMMARY = 5` — below this, skip the LLM call entirely; no fabricated pattern from noise.
- `MAX_EDITS_FOR_SUMMARY = 30` — an eligible edit is an `action_decided` entry with `detail.decision === 'edited'` and a non-empty `detail.originalDraftContent`. When more than 30 exist, only the 30 most recent (by `createdAt`) are sent to the prompt and recorded in `sourceEditCount`/`sourceFingerprint` — bounds token cost/latency for a mature account with hundreds of edits, same cost-consciousness this codebase already applies elsewhere (Phase 9's deferred-but-flagged provider-resilience concerns, the existing `budget 100 pages/scan` crawl cap). The summary is honestly scoped to "recent edit patterns," not "all-time."

## Data scoping

`AuditLogEntry` has no `websiteId` column — correctly scoped via `actionId → Action.websiteId`, the same join pattern already used elsewhere in this codebase, not a new one. The API route uses the existing `resolveWebsiteForRequest` tenant→client→website chokepoint, same as every other per-site route.

## Persistence — cached summary only

Counts stay live (cheap, always fresh). Only the expensive LLM call is cached, with full provenance so staleness is detectable and honest:

```prisma
model FeedbackAnalysis {
  id                  String    @id @default(cuid())
  websiteId           String    @unique
  website             Website   @relation(fields: [websiteId], references: [id])
  summary             String?
  sourceEditCount     Int
  sourceLatestEntryAt DateTime?
  sourceFingerprint   String?
  modelVersion        String?
  promptVersion       String?
  generatedAt         DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}
```

- `sourceFingerprint` — sha256 of the sorted `AuditLogEntry` IDs that fed the summary. The staleness mechanism: on every page load, the live sorted-ID-list fingerprint (cheap — just IDs, no full diff text refetch) is compared against the stored one. Mismatch means a new eligible edit exists since the last analysis.
- `sourceEditCount` / `sourceLatestEntryAt` — human-readable provenance shown in the UI ("12 edits analyzed, latest Sep 15"), not the staleness mechanism itself.
- `modelVersion` / `promptVersion` — follow this codebase's existing `'v1'` convention (`Finding.ruleVersion`, `Action.policyVersion`, `agent-result.ts`'s `agentVersion`). Recorded as honest metadata now; real versioned-rollback machinery is out of scope for this slice (that's the later Phase 8 unit's job, once there's an actual promoted preference to roll back).

Migration: additive only, one new table, no existing model touched.

## API surface

`POST /api/websites/[id]/feedback-analysis` — auth + `resolveWebsiteForRequest`, runs the `MIN_EDITS_FOR_SUMMARY` check, calls `generateFeedbackSummary` if eligible, upserts the `FeedbackAnalysis` row (fingerprint/counts/timestamps recomputed every call, whether or not the summary text changes), returns the row. No separate `GET` — the Analytics tab's server component reads the cached row directly via `db.feedbackAnalysis.findUnique`, and computes the live breakdown/fingerprint itself for the staleness comparison.

## UI — Analytics tab addition

New "Feedback patterns" card, placed after the existing Generation health / Agent contribution row. No new route, no new nav entry.

- **Real counts** (always shown): approve/reject/edit rate as stat chips, breakdown-by-`actionType` reusing the existing `MiniBarChart`/`ChartContainer` pattern already in Analytics.
- **AI summary block:**
  - No cached row yet, below threshold → "Analyze my edits" button disabled, honest inline reason ("Need at least 5 edited drafts — you have 2").
  - No cached row yet, eligible → enabled "Analyze my edits" button.
  - Cached row exists, fingerprint matches live → summary shown with `generatedAt` + `sourceEditCount` caveat ("Based on 12 edits, generated Sep 15").
  - Cached row exists, fingerprint stale → summary still shown (never hidden), plus an inline "N new edits since this analysis — refresh?" affordance.

## Testing

- `feedback-analysis.test.ts`: `computeDecisionBreakdown` (grouping correctness, empty state, `actionType` join correctness); `buildFeedbackSummaryPrompt` (only minimized fields present, no-invent instruction present, no brand/customer data leaked into the prompt); `generateFeedbackSummary` (mocked caller — success, empty-content fallback, error fallback); below-threshold skip logic.
- API route test: auth/ownership scoping: a website ID belonging to a different customer must 404, not leak another tenant's edit history (cross-tenant isolation, same pattern proven throughout this codebase's `/api/websites/[id]/*` routes) — explicit test for this, not assumed from the shared resolver alone; below-threshold rejection; upsert-on-repeat-call; fingerprint changes when a new eligible edit is added between calls.
- Component test for the new card: real-counts render; AI-summary-present (fresh); AI-summary-present (stale, shows refresh prompt); AI-summary-absent-eligible; AI-summary-absent-below-threshold.

## Explicitly out of scope, this slice

- Preference inference from the summary (reading pattern → writing back to `ClientProfile.restrictedWording`/`brandVoice` etc.) — the next Phase 8 unit, not this one.
- Candidate creation, holdout evaluation, human approval workflow, versioned promotion, rollback — infrastructure for *acting* on inferred preferences; nothing here infers a preference to act on yet.
- `auto_execute_toggled` audit events — a separate, minor signal; not folded into this pass to avoid scope creep beyond what "feedback on drafts" actually means.
- Cron/auto-refresh of the summary — on-demand only, matching this project's repeated "no speculative infrastructure" discipline (Phase 7A's `runAgentSafely` wrapper, Phase 9's provider-resilience deferral, etc.).
