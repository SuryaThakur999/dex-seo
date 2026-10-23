# ADR 0003: Auto-Execute Is Customer Opt-In, PASS-Only

**Status:** Accepted
**Date:** 2026-08-14

## Context
Founder requested an "auto" mode. A CAIO-advisor risk classification (held as a note, not a closed legal question — strategy doc Section 10) found EU AI Act tier MINIMAL for both human-review and fully-automated scenarios of this use case, since SEO content drafting doesn't fall in an Annex III high-risk domain. That lowers but does not eliminate the case for caution — GDPR and ordinary commercial liability still apply, and a real legal review hasn't happened yet.

## Decision
`Customer.autoExecuteEnabled`, boolean, default `false`. When `true`, only actions GrowthGuard scores PASS get `status: "approved"` automatically — FLAG and BLOCK outcomes always require manual review, unconditionally, regardless of this setting. Every toggle change is logged (on/off, timestamp) to the audit trail.

## Consequences
- Gives the founder the feature requested without contradicting the "defer to human review while the legal question is open" posture — the toggle only ever removes friction from actions GrowthGuard already vouched for, never from ones it flagged.
- The audit trail entry for toggle changes becomes a customer-consent record a future legal review will want.
- Superseded when: a real legal review either closes the GDPR/liability question or changes the terms under which auto-execute should be offered (e.g. requiring explicit consent language beyond a toggle).
