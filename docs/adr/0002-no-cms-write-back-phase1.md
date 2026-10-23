# ADR 0002: No CMS Write-Back API in Phase 1

**Status:** Accepted
**Date:** 2026-08-14

## Context
Every action is human-review-only in Phase 1 (no auto-execute by default — see ADR 0003 for the opt-in exception, and strategy doc Section 10 for why the underlying legal question stays open, not closed). Building a CMS-specific write API (Shopify Admin API, WordPress REST API, or a generic one) only to gate every write behind a manual click adds real engineering time for zero behavioral difference a customer would notice in Phase 1.

## Options considered
- **Build a write-back API now:** more "complete"-feeling product, but the customer still has to click approve either way — the API adds engineering time without adding functionality visible to a Phase 1 user.
- **Copy-paste output, no write API (chosen):** customer applies the approved change themselves. Cuts real scope from the 3-week build.

## Decision
Phase 1 ships with copy-paste-ready output only. No CMS write integration.

## Consequences
- Saves meaningful Week 2-3 engineering time.
- Adds friction to activation — flagged as an explicit open question in the technical architecture doc (Section 9): watch early customer sessions for whether this friction hurts conversion enough to justify pulling a write API forward.
- Superseded when: Phase 1 has paying customers and the friction is measured, not assumed.
