# Phase 8D — Versioned Activation & Rollback (design)

Brainstormed 2026-09-20, continuing from `2328b11` and the live Phase 8C deployment (`dpl_5bbVoZy3ahCNqtfrRiaqoyFALDAD`). Final unit of the Milestone E controlled-learning pipeline: candidate (8B) → evaluate (8C) → **activate / roll back (this phase)**.

## Mission

Let a customer turn a `passed` evaluation's phrase into an active `restrictedWording` entry ("Start using"), and reverse that at any later time ("Stop using") — an ongoing, always-available toggle, not a one-time undo window. Nothing before this phase ever wrote to `ClientProfile.restrictedWording`; this is the one slice that finally does, and only in direct response to an explicit customer click.

## Key decision: activation state is derived, not stored

`ClientProfile.restrictedWording` is already a plain `string[]`, freely edited by the customer via a full-replace textarea (`BrandPreferencesForm` → `PATCH /api/client-profile/[id]`). Two ways to track which entries came from Dex activation were considered:

1. **Derive by membership (chosen).** No schema change to `ClientProfile`. "Is this evaluation's phrase currently active" is always computed live: `restrictedWording.includes(evaluation.evaluatedPhrase)`. `PreferenceEvaluation` gets `activatedAt`/`deactivatedAt` timestamps for an audit trail only — they are never read to decide the toggle's displayed state. This means a customer manually editing the Brand Preferences textarea (removing or re-adding the exact phrase by hand) can never leave Settings' Learning section showing a stale "Active" badge — there is only one place the fact lives, and every page load re-reads it.
2. **Structured entries with metadata** (phrase + source + candidateId), replacing the textarea with a managed list. Rejected: bigger migration, reworks an existing, currently-simple form, out of this feature's boundary.

## Schema

One additive migration, no existing field removed or renamed:

```prisma
model PreferenceEvaluation {
  // ...existing fields unchanged...
  activatedAt   DateTime?
  deactivatedAt DateTime?
}
```

Audit-only. A passed evaluation with `activatedAt` set and `deactivatedAt` null has been activated and not since deactivated; both null means never activated; both set means activated once and later turned off. None of these three states is what decides the customer-visible toggle — the live `restrictedWording` membership check does that. If they ever disagree (e.g. a manual textarea edit put the phrase back after deactivation), the UI trusts the live membership, not the timestamps — the timestamps are history, not truth.

## New library: `src/lib/preference-activation.ts`

Two small pure functions, unit-testable in isolation, matching this codebase's existing "classification/threshold as pure functions" pattern from `preference-evaluation.ts`:

```typescript
export function isPreferenceActive(restrictedWording: string[], phrase: string): boolean {
  return restrictedWording.includes(phrase);
}

export function withoutPreference(restrictedWording: string[], phrase: string): string[] {
  return restrictedWording.filter((w) => w !== phrase);
}
```

`withoutPreference` strips every exact match, not just the first — if a customer's textarea happens to contain the same phrase twice (e.g. typed once manually, then Dex also activated it), deactivating removes all of them, since duplicates carry no separate meaning once membership is the only signal that matters.

## New route: `POST /api/preference-candidates/[id]/activation`

Same shape as the existing `decide` route — one route, an `action` field in the body, same ownership-verification pattern (`candidate.clientProfile.customerId !== customer.id` re-checked from the freshly-loaded row, never trusted from an earlier step).

```
body: { action: 'activate' | 'deactivate' }
```

- Loads the candidate with `clientProfile: { select: { id: true, customerId: true, restrictedWording: true } }` and `evaluation: true`.
- 404 if the candidate doesn't exist, doesn't belong to the authenticated customer, or has no `evaluation` row yet.
- **`activate`:** 400 unless `evaluation.status === 'passed'`. If the phrase is already present (`isPreferenceActive`), no-op the `restrictedWording` write (idempotent — a double-click can't create a duplicate). Otherwise `db.clientProfile.update({ data: { restrictedWording: { push: phrase } } })` — Postgres-native array `push` is atomic at the database level, so this is race-free even without a transaction. Then `db.preferenceEvaluation.update({ data: { activatedAt: new Date() } })`.
- **`deactivate`:** compute `withoutPreference(clientProfile.restrictedWording, phrase)` and write it back with a plain `update`. This *is* a read-then-write (Prisma has no atomic "remove array element" for Postgres native arrays, unlike `push`), so a customer clicking "Stop using" at the exact same instant as a manual Brand Preferences save could theoretically race. Accepted risk: this is a low-frequency, single-actor, explicitly-clicked action, not an automated high-frequency path like the Phase 8C decision routes — worth noting, not worth a transaction/locking scheme for this slice. Then `db.preferenceEvaluation.update({ data: { deactivatedAt: new Date() } })`.
- Returns `{ isActive: boolean }`, recomputed from the just-written state, not assumed.

## UI: Settings → Learning section

`src/app/settings/page.tsx`'s `candidates` query select gains `evaluation: { select: { status: true, evaluatedPhrase: true } }` (already selects `status` alone as of Phase 8C — extending it to include the phrase). For each row where `evaluation.status === 'passed'`, compute `isActive` from the already-fetched `clientProfile.restrictedWording` and pass it down.

`LearningSection` renders a new client component per `passed` row — `ActivationToggle` (same pattern as the existing `AutoExecuteToggle`: a small client component taking an id and initial boolean, POSTing on click, reflecting the response). Button reads "Start using" when inactive, "Active — Stop using" when active. This replaces the plain status label only for `passed` rows; every other status (`pending`/`evaluating`/`insufficient_evidence`/`failed`, and non-`approved_for_evaluation` statuses) renders exactly as Phase 8C already built, unchanged.

No change to the Review page or `PreferenceSuggestionCard` — that card's job ends at "Evaluate this preference," and by the time an evaluation resolves to `passed` the candidate has long since left that card's session-scoped state. Settings' Learning section is the only surface that reads the live evaluation status from the database on every load, so it is the only place a "Start using" affordance can correctly appear.

## Explicitly out of scope, this slice

- Any change to how evaluation itself runs (Phase 8C's classification/threshold logic is untouched).
- A history/timeline view of activation events beyond the two audit timestamps.
- Bulk activate/deactivate across multiple candidates.
- Race-hardening the `deactivate` read-then-write beyond the accepted-risk note above.

## Testing

- `isPreferenceActive` / `withoutPreference` — pure function tests, including the duplicate-entry case.
- Activation route: activate when `passed` (succeeds, pushes once), activate when not `passed` (400), activate when already active (no-op, no duplicate push), deactivate (removes, including the duplicate-entry case), deactivate when not currently active (no-op), tenant-ownership rejection (same pattern as every other route's isolation test in this codebase), 404 when no evaluation row exists yet.
- `ActivationToggle` component: renders correct label for active/inactive, POSTs the right action, reflects the response.
- Settings page: `isActive` computed correctly from `restrictedWording` membership for a `passed` row; non-`passed` rows render unchanged from Phase 8C.
- Full regression: existing Phase 8A/8B/8C tests re-run unmodified.
