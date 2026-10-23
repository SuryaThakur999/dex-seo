# Phase 7A — Agent Council Foundation (scaled-down directive)

Saved verbatim as received 2026-09-16/17, per this repository's established convention. This is the scaled-down directive the user issued after accepting the pushback recorded in `docs/superpowers/plans/2026-09-16-dex-god-mode-capability-gap-matrix.md` (against building the full DEX GOD MODE circuit-breaker/quarantine/GitHub-skill apparatus). It was implemented in two parts:

- Items 1-2 (Brand restricted wording, SEO/GEO consolidation) were completed first as their own bounded unit, commit `f499a93` — see `docs/superpowers/specs/2026-09-16-phase7-priority-fix-directive.md` for that scoped directive's exact text.
- Items 3-6 (normalized envelope, orchestrator decision record, execution-result wrapper, Opportunity Board + Agent Evidence Ledger integration) were completed as this directive's remaining scope, commit `0f9459a` — see `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md`'s "Phase 7A Agent Council Foundation, items 3-6" entry for the completion report.

Kept here as source-of-truth for the full original scope (including item 1-2's original wording, which duplicates the priority-fix directive almost verbatim), not paraphrased.

---

Continue from deployed commit f499a93. Inspect and preserve the completed restricted-wording and SEO/GEO consolidation work. Do not reimplement those fixes unless testing identifies a defect. Treat items 1–2 as verification requirements and focus implementation on the remaining Phase 7A foundation.

Proceed with the scaled-down recommendation, with the following mandatory boundaries.

Your pushback is accepted: do not build an elaborate circuit-breaker, quarantine, rollback or runtime GitHub-skill engine around four deterministic functions that have no independent execution process. Do not spend this session manufacturing infrastructure that has no current failure surface.

However, do not reduce Phase 7 to two hard-coded fixes.

Build one coherent **Phase 7A — Agent Council Foundation** containing:

1. Fix the Brand Specialist gap:

   * evaluate existing crawled page copy against the customer's real restricted-wording preferences
   * reuse the existing tenant-scoped preference source
   * preserve evidence showing the actual matched wording and affected URL
   * do not send the entire preference history or unrelated customer data

2. Fix the real cross-agent duplicate:

   * consolidate the SEO `missing_structured_data` and GEO `missing_entity_markup` findings only when they refer to the same underlying evidence and affected page
   * do not merely hide one row in the UI
   * preserve both contributing agents, original rule IDs and supporting evidence
   * ensure similar but materially different findings remain separate

3. Create a lightweight normalized agent-result envelope:

   * agent ID
   * agent version
   * rule ID
   * rule version
   * affected URL
   * evidence reference or stable evidence identity
   * severity
   * confidence
   * confidence basis
   * rationale
   * recommended action
   * limitations
   * citations when they exist
   * language and market using honest `not_evaluated` states
   * model and prompt version only when genuinely applicable
   * timestamp

   Do not migrate all historical rows or redesign the entire database unless persistence is required for correctness. Prefer a backward-compatible adapter over a broad migration.

4. Add a deterministic orchestration layer:

   * accepts normalized results
   * identifies duplicates through a small transparent rule registry
   * is extensible beyond the one known duplicate
   * preserves contributor provenance
   * produces a concise decision record
   * remains idempotent on retries
   * performs no LLM call for deterministic deduplication

5. Add a minimal execution result wrapper:

   * `passed`
   * `blocked`
   * `failed`
   * validation errors
   * duration
   * agent version

   Do not build distributed runtime lifecycle machinery yet. The purpose is to establish an observable contract that later phases can extend.

6. Integrate the result into the existing Opportunity Board and Agent Evidence Ledger:

   * show that the orchestrator combined overlapping findings
   * allow the user to expand the contributing evidence and agents
   * do not add fictional chats, C-level titles or decorative activity
   * do not duplicate the Opportunity Board

7. Add real tests:

   * restricted wording found in existing page copy
   * restricted wording absent
   * customer-specific preferences remain isolated
   * real structured-data/entity-markup duplicate consolidates
   * different-page findings do not consolidate
   * related but materially different findings remain separate
   * contributor evidence is preserved
   * orchestration is idempotent
   * historical findings still render
   * URL-only scanning remains independent of GSC
   * tenant and website isolation remain enforced

8. Run:

   * focused tests
   * full `vitest run`
   * `tsc --noEmit`
   * `next build`

9. Use Agent B to review the actual diff for:

   * evidence loss
   * over-grouping
   * cross-tenant preference leakage
   * fabricated metadata
   * historical compatibility
   * misleading dashboard language
   * unnecessary architecture

10. Perform one consolidated fix pass and deploy once through the authorized Vercel process.

Browser-verify the resulting Opportunity Board and decision record with a real authenticated account where possible. If unavailable, report it honestly as not browser-verified.

## Explicit deferrals

Record these as separate authorized follow-up units:

### Phase 7B — Production Agent Harness

Add full retries, circuit breakers, quarantine, last-known-good rollback and per-agent token/model policies when agents have independent model/provider failure surfaces.

### Phase 6 — Regional Intelligence

Build verified regional knowledge packs, locale-aware evidence, Regional Market Strategist and Native-Language Editor before claiming multilingual Agent Council coverage.

### Knowledge Steward

Treat this as a separate security-sensitive build containing:

* approved-source registry
* safe scheduled retrieval
* freshness detection
* conflict handling
* candidate review
* versioned promotion
* prompt-injection protection

Do not attach unrestricted internet collection directly to the live scan path.

### Phase 8 — Controlled Learning

Implement candidate preference inference, holdout evaluation, approval, promotion and rollback after normalized results and provenance exist.

### Phase 9 — Provider Resilience

Implement persistent queues, `Retry-After`, exponential backoff, token reservation, idempotency and circuit breakers for real provider-dependent generation.

## Skills decision

Do not install GitHub skills merely because the directive mentioned them.

For this deterministic Phase 7A slice:

* inspect installed skills and repository instructions
* use existing testing, security, TypeScript and SEO capabilities
* install an external skill only if you identify a specific capability gap
* inspect its complete `SKILL.md`, scripts, license and dependencies
* pin the exact version
* record the reason and assigned role

Skills are build-time instruction packages, not an unreviewed runtime "brain."

## Accurate completion statement

Do not report the entire Agent Council or God Mode as complete.

Use:

> Phase 7A foundation shipped: existing agents now share a normalized result contract, Brand checks tenant-scoped restricted wording, and the deterministic orchestrator consolidates the verified SEO/GEO overlap while preserving evidence and contributors. Regional agents, Knowledge Steward, controlled learning and production resilience remain separately scoped follow-up units.

Continue through this complete Phase 7A unit without stopping to request approval for each small change.
