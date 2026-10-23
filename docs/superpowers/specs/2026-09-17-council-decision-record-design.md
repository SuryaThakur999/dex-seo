# Council decision record — §9 Controlled Team Discussion (real-population scope)

Design doc, brainstormed and approved 2026-09-17. Implements the master directive's `docs/superpowers/specs/2026-09-16-dex-god-mode-agent-council-directive.md` §9 (Controlled Team Discussion), scoped down to what has real data behind it today — the same discipline `docs/superpowers/plans/2026-09-16-dex-god-mode-capability-gap-matrix.md` already established for §3/§12.

## Why scoped down

§9 asks for conflict detection between agents, a bounded challenge round, and recorded dissent. Checked all 9 rule IDs across the three specialist agents (`seo-specialist.ts`, `geo-specialist.ts`, `brand-specialist.ts`): each rule checks an independent, non-overlapping fact. No two agents can produce a genuinely conflicting recommendation about the same page today — the only cross-agent relationship that exists is the one confirmed exact-duplicate pair (`missing_structured_data` / `missing_entity_markup`) `agent-orchestrator.ts` already consolidates. Building conflict/challenge/dissent machinery now would have zero real cases to exercise it, repeating the mistake the capability-gap-matrix already flagged once for §3/§12.

User confirmed (2026-09-17): build the real-population version only.

## What's actually missing

`buildDecisionRecord` and the `DecisionRecord` interface already exist in `src/lib/agent-orchestrator.ts` (built in Phase 7A) but are dead code — grepped, zero callers anywhere outside their own file. `computeOpportunityGroups` in `src/lib/opportunity-board.ts` calls `consolidateFindings` but never calls `buildDecisionRecord`. This design closes that gap and extends the record to the fuller field set §9 specifies, with every new field backed by a real value or an honest empty/not-applicable state — never a fabricated placeholder.

## Data model changes

Extend `DecisionRecord` in `src/lib/agent-orchestrator.ts`:

```ts
export interface DecisionRecommendation {
  agent: string;
  ruleId: string;
  suggestedAction: string;
  limitations: string | null;
}

export interface DecisionRecord {
  issue: string;
  resolutionRule: string;
  participatingAgents: string[];
  evidenceRefs: string[];
  reason: string;
  timestamp: string;
  // New fields below — each sourced from real data, honest empty state where no real value exists.
  recommendations: DecisionRecommendation[];
  agreement: 'agreed'; // literal type today — consolidateFindings only ever fires when both
                        // agents independently confirm the same fact; no other value is possible
                        // until a real conflicting rule pair exists.
  disagreement: null;  // always null today — no real conflict case exists (see "Why scoped down").
  finalRecommendation: string; // the higher-severity contributor's suggestedAction, reusing the
                                 // existing SEVERITY_RANK tie-break already in consolidateFindings.
  confidence: 'high'; // literal type today — the only real case is full agreement between agents.
  limitations: string | null; // contributors' real limitations, joined; null when both are null.
  owner: 'not_applicable'; // single-operator account model, no ownership-assignment feature exists.
  measurementPlan: string; // real fixed string referencing OBSERVATION_WINDOW_DAYS (28) from
                            // dashboard-stats.ts — the same window Outcomes already uses.
}
```

`agreement`, `disagreement`, and `confidence` are deliberately narrow literal types (not the broader unions §9's prose implies) so the type system itself documents that this is the real-population scope — widening them is exactly the signal a future session should read before adding conflict handling for real.

`buildDecisionRecord(opportunity, now)` gets the extra fields computed from `opportunity.pages[].contributors` (already available) plus one new import of `OBSERVATION_WINDOW_DAYS` from `dashboard-stats.ts`.

## Wiring

`computeOpportunityGroups` (`opportunity-board.ts`) calls `buildDecisionRecord` for each consolidated opportunity and attaches the result to `OpportunityGroup.decisionRecord?: DecisionRecord` (new optional field, mirrors how `consolidationReason` is already attached).

## UI

`OpportunityBoard`'s existing `<details>` panel (currently: "Combined by the orchestrator — N contributing findings" + `consolidationReason` + per-contributor rows) gets one more block below the contributor list, only when `group.decisionRecord` is present:

```
Resolution: {resolutionRule}
Agreement: {agreement}
Final recommendation: {finalRecommendation}
Measurement: {measurementPlan}
```

Same `text-xs text-muted-foreground` styling already used for the contributor rows in that panel — no new visual pattern, no new card, no new page.

## Testing

- `src/lib/agent-orchestrator.test.ts` (exists): add cases asserting the new fields on `buildDecisionRecord`'s output — recommendations array shape, agreement/disagreement/confidence literals, finalRecommendation severity tie-break, owner/measurementPlan literal values.
- `src/lib/opportunity-board.test.ts` (exists): assert `decisionRecord` is attached to consolidated groups and absent from non-consolidated ones.
- Component test for `OpportunityBoard` if one exists: assert the new detail block renders when `decisionRecord` is present.
- Full suite (`vitest run`), `tsc --noEmit`, `next build` must stay green.

## Out of scope (explicitly, not by omission)

Conflict detection, bounded challenge rounds, real dissent recording, `review_required` state, unsupported-recommendation rejection — all real §9 requirements, all deferred because no real agent disagreement exists yet to build them against honestly. Revisit when a rule pair with genuine conflict potential is added.
