# ADR 0004: GrowthGuard MVP Is a Hardcoded Checklist, Not a Scoring Model

**Status:** Accepted
**Date:** 2026-08-14

## Context
The original product concept describes GrowthGuard as an explainable, reversibility-weighted risk-scoring model across Risk/Policy/Permission/Compliance. A 5-advisor council premortem (see strategy doc Section 11) flagged building this scoring model before any customer validated the need as the single biggest execution risk: it's genuinely hard, novel infrastructure, and a solo founder building it in parallel with three other engines was the specific failure mode traced from "over-built GrowthGuard" to "no pilot customers when revenue was needed."

## Decision
Phase 1 GrowthGuard is a fixed rule checklist (five explicit checks, each pass/fail with a named reason — see technical architecture doc Section 3), not a weighted or learned model. The four-question separation (Risk/Policy/Permission/Compliance) is preserved conceptually but implemented as plain rules, not a scoring system.

## Consequences
- Ships in the 3-week window instead of requiring months of scoring-model design work with no customer data to calibrate against.
- The `GuardResult` schema (checksRun, reasoning, outcome) is forward-compatible with a future scored model — this ADR is about implementation now, not the eventual product vision.
- Superseded when: real customer/action volume exists to justify and calibrate a scored model (see strategy doc Section 5's Learning Engine, deferred until 10 paying customers).
