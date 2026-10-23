# Phase 8B — Suggested Preferences (design)

Brainstormed 2026-09-19/20, the next Milestone E unit after Phase 8A's read-only feedback-analysis foundation. Scoped down from the design doc's original "candidate preference inference + holdout evaluation + human approval + versioned promotion + rollback" — this slice covers candidate creation + the customer's one decision only. Holdout evaluation ("Quality check") and versioned promotion/rollback ("Start using" / "Undo") are explicitly separate, later, unstarted units.

## Product direction

Learning must not become an additional customer task. No "Suggest a preference" button, no dashboard tab to monitor, no candidate queue to manage. Dex observes normal Review activity and surfaces at most one contextual decision, at the moment of highest context, in plain language — never a second tool the customer has to operate.

**Full intended lifecycle (only the first three steps exist after this slice):**

```
Normal edits → Dex notices a repeated pattern → one contextual confirmation
  → [not built yet: background quality check → "ready to use" confirmation
      → preference becomes active → one-click undo]
```

This slice stops at "Evaluate this preference / Not a preference." Approving does **not** change `ClientProfile.restrictedWording` — it only records `approved_for_evaluation`. The UI says so explicitly, every time.

## Customer-facing language

Never expose internal terms. Full mapping:

| Internal term | Customer wording |
|---|---|
| Preference candidate | Suggested preference |
| LLM inference | Dex noticed a pattern |
| Approved for evaluation | Evaluate this preference |
| Holdout evaluation | Quality check |
| Promotion | Start using |
| Rollback | Undo |
| Source fingerprint | Based on N reviewed drafts |

Model versions, prompt versions, fingerprints — never shown except inside an expandable "technical evidence" disclosure, for anyone who wants it.

## Where it appears

- **Primary:** a contextual card inside the existing Review workflow, shown when a `proposed` candidate exists for the website being reviewed. Copy: *"Dex noticed a pattern — You removed 'industry-leading' from 4 drafts. Should Dex evaluate avoiding this phrase in future drafts?"* with two actions: **Evaluate this preference** / **Not a preference**.
- **Secondary:** a compact "Learning" section in Settings, showing pending / evaluated / active suggested preferences for transparency and audit. No badge, no attention-demanding indicator — routine learning isn't urgent.
- **Optional detail:** full suggestion history (all decided + pending candidates, with their evidence) reachable from that Settings section.
- **Explicitly not built:** a dedicated Suggestions dashboard tab, a mobile bottom-nav entry, any badge/counter.

## Candidate lifecycle

States: `proposed` → `approved_for_evaluation` | `rejected` | `superseded`.

- **`proposed`**: a fresh, deterministically-verified candidate, undecided.
- **`approved_for_evaluation`**: customer said "Evaluate this preference." No effect on `ClientProfile` yet — that's the deferred promotion slice's job. Preference stays visibly inactive; the Settings section states this plainly ("Active preferences unchanged").
- **`rejected`**: customer said "Not a preference." That exact phrase (case-insensitive, word-boundary match) is never auto-suggested again for this `(websiteId, clientProfileId, targetField)`.
- **`superseded`**: only reachable if a fresh automatic check runs while an old `proposed` candidate for the same scope is still undecided AND produces a materially different phrase — the old row is marked `superseded`, linked via `supersededById`, rather than silently discarded or left to accumulate. In practice this should be rare, since a `proposed` candidate already blocks new checks for that scope (see Automation Boundaries) — kept as a defined escape hatch, not a routine path.

**Editing before deciding:** a customer can edit the proposed phrase before choosing "Evaluate this preference." This does not create a new row or trigger `superseded` — it sets `customerEditedPhrase` on the same row (preserving `originalProposedPhrase` untouched alongside it) and moves that row directly to `approved_for_evaluation`.

**Data retention:** decisions are kept for auditability by default (matches this project's append-only `AuditLogEntry` convention), but nothing in the schema structurally blocks a real delete or anonymization later for data-deletion requests — foreign keys use `ON DELETE RESTRICT`, matching this schema's existing convention throughout; deletion isn't blocked by this feature specifically, it's blocked the same way every other customer-data relation in this schema already is. Building the actual deletion/anonymization admin flow is out of scope for this slice.

## Deterministic verification gate

The LLM proposes; this gate decides whether a candidate is ever actually created. All conditions must hold, or the outcome is recorded as "no clear pattern" (never a forced candidate):

1. The proposed phrase exists (case-insensitive, word-boundary-aware — reusing `checkRestrictedWording`'s existing matching logic, not reimplemented) in the `before` text of at least one eligible edit.
2. Absent or materially changed in that same edit's `after` text.
3. The same phrase-removal pattern appears across at least `MIN_SUPPORTING_EDITS = 2` distinct eligible edits — a single edit is never enough support, independent of the overall `MIN_EDITS_FOR_SUMMARY = 5` eligibility floor reused from Phase 8A.
4. Every piece of supporting evidence comes from queries built from `websiteId`/`clientProfileId` values that themselves came from `resolveWebsiteForRequest` — cross-tenant data cannot enter the eligible-edits set. This is scoping correctness, not a separate verification step.
5. The phrase is not already present in `ClientProfile.restrictedWording`.
6. The phrase is not already represented by an existing `proposed`, `approved_for_evaluation`, or `rejected` candidate for this `(websiteId, clientProfileId, targetField)`.

Candidate rows preserve the evidence that passed this gate: `evidenceEntryIds` (the specific `AuditLogEntry` IDs) and `evidenceExcerpts` (the actual before/after snippets) — not just a count. This is what the "technical evidence" disclosure shows.

## Automatic trigger — non-blocking post-render check, not a job queue

This codebase has no background job/queue infrastructure (every existing scan-like operation runs inline in its own request handler; Phase 9's provider-resilience/queue work is explicitly deferred project-wide). This is **not** a job queue and is not described as one anywhere in the implementation. Instead:

1. **Server render (Review page), cheap only:** compute a boolean `mayHaveCandidateCheck` from data already in memory or a cheap lookup — no LLM call during SSR, no added latency to the page. True when: eligible-edit count ≥ `MIN_EDITS_FOR_SUMMARY`, no currently-`proposed`/`approved_for_evaluation` candidate blocks this `(websiteId, clientProfileId, targetField)`, and the live eligible-edits fingerprint differs from the last fingerprint this scope was actually checked against (see the check-ledger below). Edit submission itself (`edit/route.ts`) is completely unchanged — no new work added to that path.
2. **Client, once interactive, only if the flag is true:** fire one authenticated `POST` to a new check endpoint. Non-blocking with respect to page usability — the Review page is fully usable before, during, and if this call is slow or fails.
3. **The endpoint re-verifies everything itself**, never trusting the client-computed flag: tenant ownership (via `resolveWebsiteForRequest`), the eligibility threshold, the live fingerprint, existing-candidate/rejected-phrase exclusions, then runs the LLM extraction + the full deterministic verification gate above.
4. **Idempotency via a persisted check-ledger, not a time-based cooldown.** A new lightweight row (one per `(websiteId, clientProfileId, targetField)`) records the last-checked fingerprint and its outcome — `candidate_created` (with a link), `no_pattern`, or `failed` — every time, including negative and failed outcomes. Before doing any real work, the endpoint compares the live fingerprint against this row's stored one: identical → return the stored outcome immediately, no new LLM call, no new candidate. This is what makes concurrent tabs, page reloads, and prefetching safe — a duplicate `POST` for the same fingerprint is a cheap read, not a repeat model call. A genuinely new fingerprint (new eligible edits arrived) is the only thing that triggers real work, which is itself the natural cooldown — no separate timer needed.
5. **On success**, the client updates to show the contextual card once the request resolves. No polling, no websockets — a plain fetch-then-render.

## Schema

Two new tables. Both additive; no existing model touched.

```prisma
model PreferenceCandidate {
  id                      String    @id @default(cuid())
  clientProfileId         String
  clientProfile           ClientProfile @relation(fields: [clientProfileId], references: [id])
  websiteId               String
  website                 Website   @relation(fields: [websiteId], references: [id])
  targetField             String    // 'restrictedWording' only, for now — string not enum, matching this
                                     // codebase's existing convention for actionType/eventType-style fields
  originalProposedPhrase  String
  customerEditedPhrase    String?
  rationale                String
  evidenceEntryIds        String[]
  evidenceExcerpts        Json      // [{ auditLogEntryId, before, after }]
  status                  String    // 'proposed' | 'approved_for_evaluation' | 'rejected' | 'superseded'
  supersededById          String?
  sourceFingerprint       String
  modelVersion            String
  promptVersion           String
  generatedAt             DateTime  @default(now())
  decidedAt               DateTime?
}

model PreferenceCandidateCheck {
  id                  String   @id @default(cuid())
  clientProfileId     String
  websiteId           String
  website             Website  @relation(fields: [websiteId], references: [id])
  targetField         String
  lastFingerprint     String
  lastOutcome         String   // 'candidate_created' | 'no_pattern' | 'failed'
  lastCandidateId     String?
  checkedAt           DateTime @default(now())

  @@unique([websiteId, clientProfileId, targetField])
}
```

## API surface

`POST /api/websites/[id]/preference-candidates/check` — the non-blocking post-render trigger described above. Auth + `resolveWebsiteForRequest`, idempotent via `PreferenceCandidateCheck`, only calls the model when the live fingerprint genuinely differs from the last-checked one.

`POST /api/preference-candidates/[id]/decide` — body `{ decision: 'evaluate' | 'reject', editedPhrase?: string }`. Tenant-scoped (candidate's `clientProfileId` must belong to the requesting customer). Sets `customerEditedPhrase` if provided, transitions status, sets `decidedAt`. Never touches `ClientProfile`.

## UI

- Review page: a dismissible-but-not-required contextual card, rendered when a `proposed` candidate exists for the website in view. Shows the customer-facing copy above, the two actions, and an expandable "why Dex suggested this" section revealing the real evidence excerpts (not the internal fingerprint/model/prompt fields — those stay in the Settings-side technical detail view only, for anyone auditing).
- Settings: a compact "Learning" section — pending / evaluated / rejected suggested preferences for this profile's websites, each linking to the full evidence detail. No dashboard tab, no mobile nav entry, no badge.

## Testing

- Deterministic verification gate: each of the 6 conditions, both pass and fail cases, using real before/after text fixtures — not mocked pattern-matching.
- `PreferenceCandidateCheck` idempotency: identical fingerprint on a second call returns the stored outcome without invoking the LLM caller; a changed fingerprint does invoke it.
- Cross-tenant isolation on both new routes (foreign `websiteId`/candidate `id` → 404/403, no data leak) — same pattern this project already proves on every other per-site route.
- Reject-phrase exclusion: a previously-rejected phrase is never re-proposed even when the pattern recurs in new edits.
- Customer-edit-before-decide: `customerEditedPhrase` set, `originalProposedPhrase` untouched, status moves straight to `approved_for_evaluation`.
- `superseded` path: a second automatic check with a different qualifying phrase while an old `proposed` row is undecided correctly marks the old row `superseded` and links it.

## Explicitly out of scope, this slice

- Holdout evaluation ("Quality check") — no mechanism exists yet to test a candidate before promotion.
- Versioned promotion / "Start using" — approving never writes to `ClientProfile.restrictedWording` in this slice.
- Rollback / "Undo" — nothing to undo yet, since nothing is ever applied.
- A real deletion/anonymization admin flow — the schema doesn't block it, but it isn't built here.
- Any field beyond `restrictedWording` — `targetField` is a string for future extensibility, but only one inference path exists.
