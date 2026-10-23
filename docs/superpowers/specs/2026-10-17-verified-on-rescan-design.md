# Verified on next scan (design)

Date: 2026-10-17. Status: approved by the human, including the additive schema change below.

## Problem

Outcomes only exist for actions a human approved on a site with Google Search Console connected, measured 31 days later. Owners often fix Dex's findings outside Dex (the Yoki case: canonical tags, Organization JSON-LD, an internal link and a robots.txt exclusion, done in the site's own repo). Dex never learns that its finding was right and got fixed, so Outcomes stays empty and Dex cannot show how its findings perform. Sites that Google cannot crawl yet (password-gated pre-launch sites) never produce GSC outcomes at all.

## What changes

After every completed scan, Dex compares each open finding from earlier scans of the same website with the new scan and records what happened. No human approval is needed for this record; it is an observation, not a decision.

**Matching key:** same `websiteId`, same normalised `pageUrl` (lowercase host, no trailing slash, no fragment; the bare domain and `/` count as one page), same `agent` and `ruleId`.

**Resolutions** (new `Finding.resolution`):
- `fixed`: the page was crawled with HTTP 200 in the new scan and the rule no longer fires. Store the positive evidence the rule saw (for example "canonical tag found: https://…").
- `excluded`: the page is now disallowed by robots.txt or returns `noindex`. Counts as resolved, shown as "Excluded from index on purpose", never as fixed.
- `could_not_verify`: the page returned 401, 403, 404, 5xx or a timeout, or the new scan did not reach it. Not resolved; the finding stays open and the reason is shown.
- No resolution: the rule still fires. The finding stays open and shows "Still found on <scan date>".

`fixed` and `excluded` set `resolvedAt` and `resolvedByScanJobId`. A finding that comes back in a later scan after being `fixed` opens a new finding and is shown as "Came back on <date>"; the old record is kept.

**Effect on Review:** an action whose provenance findings are all `fixed` or `excluded` leaves the Review queue. Its `ActionStatus` is not changed (no fake human approval). An `AuditLogEntry` with `eventType = 'finding_resolved_on_rescan'`, actor `dex`, and detail `{ findingId, resolution, scanJobId, evidence }` records it.

**Outcomes:** a new "Verified fixes" block on the Outcomes tab, above the GSC evidence table:
- count of findings `fixed` and `excluded` in the last 30 and 90 days, with median days from first found to verified;
- a list grouped by rule, each row with page, dates and the proof line;
- per rule, the share of findings the owner rejected as false positive (reject reason), so weak checks are visible.
GSC traffic outcomes stay as a second layer when GSC is connected.

## Schema (human-approved, additive)

On `Finding`, all nullable, no default data change:
- `resolvedAt DateTime?`
- `resolvedByScanJobId String?`
- `resolution String?` (`fixed` | `excluded` | `could_not_verify`)
plus an index on `(websiteId, resolvedAt)`. Migration reviewed by Dwight; applied to production only at deploy with the human's yes. Agents run it only against the dev branch `ep-long-truth`, never `.env.local`.

## Not doing

- Changing `ActionStatus` or writing a human decision on the owner's behalf.
- Counting `could_not_verify` as fixed.
- Any claim about traffic impact from this signal alone.

## Build and review

Pam builds, Dwight reviews (schema, scan pipeline, audit log). Ryan reviews the Outcomes block copy. Tests first. Tier 2 design rule for the Outcomes block; overseer takes signed-in screenshots at 320, 768 and 1280px. Priority: right after the 2E closing slice, before competitor discovery.

## Acceptance

- Unit tests for each resolution, including the bare-domain and trailing-slash match, robots.txt and `noindex` exclusion, 401 giving `could_not_verify`, and a finding that comes back.
- An action with all provenance findings resolved leaves Review; its `ActionStatus` and `decidedAt` are unchanged; one audit event per resolved finding.
- Outcomes "Verified fixes" renders empty, loading and filled states.
- Re-running the same scan comparison twice writes nothing new (idempotent).
