# Decision: platform-agnostic, manual apply is permanent (2026-10-02)

**Status:** Accepted. Decided by the account owner with god after reviewing `2026-10-02-dex-team-architecture-assessment.md`.

## Decision

Dex stays URL-first and platform-agnostic permanently. It does not write fixes back to customer sites on any platform. The customer applies an approved fix by hand, copying it from the Proof Receipt. That is the product model, not an interim step.

## Rationale

- **The differentiator is zero-login audit value.** A shop owner gets real findings and reviewed drafts from a URL alone. Requiring a platform connection before value works against that.
- **Auto-apply is unvalidated.** No customer has said manual apply is what stops them. The assessment found no customer or design-partner evidence in the repo at all.
- **Write-back multiplies maintenance.** Each platform (Shopify, WooCommerce, WordPress, custom stacks) needs its own connector, preview, read-after-write verification and revert. The matrix is unbounded, and every cell is code to keep working against APIs Dex doesn't control.

## Cancelled

- Gate 2 from the assessment (Shopify connect, apply, refetch, verify, revert). Cancelled, not paused.
- Phase 3D (publishing integration ADR and connector) and Phase 3E (apply, verify, monitor, revert) of the 2026-09-23 directive, as they relate to writing to a live site.

## Stays

- `src/app/api/shopify/*` (OAuth and GDPR webhooks) stays as-is. The webhooks may be compliance plumbing independent of write-back, and no live merchants are connected, so removal isn't urgent. It gets no further investment.
- Gate 1 stays the near-term target: URL-only audit, Opportunity Board, one approved draft, Proof Receipt, manual apply.
- The GrowthGuard approve-before-publish gate stays the core of the product. "Publish" means the customer's own copy-paste.

## Consequences

- Product and marketing copy must not imply Dex writes to a customer's site (assessment, open risk 2).
- Proof Receipts and apply instructions carry the full weight of the last step, so they must be clear enough for a non-technical owner to apply without help.
- Reopening this needs new customer evidence that manual apply is the actual blocker, brought to the account owner.
