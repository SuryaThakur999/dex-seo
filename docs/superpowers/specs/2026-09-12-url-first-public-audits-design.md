# URL-First Public Audits (MVP) — Design

> Scope: the MVP slice of the "Website-First Audits" master directive — make
> public URL auditing work end-to-end with zero Google connection. Dashboard
> visual redesign, platform icons, and Content Studio wiring are a separate,
> later slice.

**Goal:** A signed-in customer enters any public URL, runs an audit, and gets
evidence-backed findings — without ever connecting Google Search Console.
GSC becomes a fully optional enrichment layer, never a prerequisite.

**Architecture:** Split "the URL being audited" from "the optional verified
Search Console property" into two independent fields on `Website`. Give the
scan pipeline a Google-free page-discovery path (homepage crawl + sitemap +
internal links) alongside its existing GSC-performance path. Remove the
hard block in `/api/scan` that currently requires a GSC token to run at all.

## Data model

Add one nullable column:

```prisma
model Website {
  ...
  gscPropertyUrl String?  // the verified Search Console property, if one is selected — fully independent of `url`
}
```

`url` (existing field) becomes exclusively "the thing being crawled" —
always the real value the customer typed, set once at creation, never
overwritten by anything Google-related again. `PENDING_WEBSITE_URL` stops
being written to `url` by any code path going forward; it survives only as
a **legacy marker** on the one existing row that predates this change
(`cmtycp85c000aifgfdrbhljj7`, "YOKI").

`normalizedHost` (existing field) keeps its current job: the
duplicate-detection key derived from `url`.

## Legacy row handling

Exactly one production row still has `url === PENDING_WEBSITE_URL`. Per the
directive, this is fixed through **explicit confirmation**, not silent
backfill: `/settings` shows a "Confirm your website URL" prompt for any row
still on the sentinel, prefilled with `normalizedHost` as a suggestion, not
auto-applied. Submitting it sets `url` to the confirmed value and the row
never revisits this state.

## Route changes

**`POST /api/websites`** (add-website flow) — stop reparenting the new
site's `url` to `PENDING_WEBSITE_URL` on sibling-token inheritance. A new
site's `url` is exactly what the customer typed, immediately auditable.
Sibling GSC-token inheritance (already gated on `!gscReconnectRequired`)
still happens — it grants Google auth for later property selection, it no
longer fakes the crawl identity to make that possible.

**`POST /api/gsc/select-site`** — writes the chosen verified property to
`gscPropertyUrl`, never to `url`/`normalizedHost`. Everything else about
this route (Google-call classification, reconnect-flag anchoring) is
unchanged.

**`POST /api/scan`** — remove the `if (!website.gscRefreshToken) return 400`
block entirely. Replace the `url === PENDING_WEBSITE_URL` guard's meaning:
it now blocks only the one legacy-row case above ("confirm your URL
first"), not the general "no Google" case. A site with no GSC connection at
all runs a public audit immediately.

## Scan pipeline (`run-scan.ts`)

Branch on whether a healthy, property-resolved GSC connection exists
(`website.gscRefreshToken && !website.gscReconnectRequired && website.gscPropertyUrl`):

- **With GSC:** unchanged — `listPagePerformance(token, website.gscPropertyUrl)`
  (note: reads `gscPropertyUrl`, not `url`) plus sitemap supplement, exactly
  today's merge/reserve-slot logic.
- **Without GSC (new default):** page list comes from crawling
  `website.url`'s homepage, extracting same-hostname internal links, merged
  with `fetchSitemapUrls(website.url)` (existing), deduped, capped at the
  existing `MAX_PAGES_PER_SCAN`. Each resulting page gets `impressions: 0,
  clicks: 0, ctr: 0` (the existing convention for sitemap-only entries —
  "no search-performance data," not "zero performance").

Everything downstream (`fetchPageMeta`, `flagPages`, drafting, ProofLayer)
is unchanged — it already operates on generic page-URL lists regardless of
where they came from.

**New capability:** internal-link extraction. Added to `crawler.ts`
alongside the existing lightweight regex-based HTML parsing (`parsePageMeta`)
— no new HTML-parsing dependency. Extracts `href` values from `<a>` tags,
resolves relative URLs against the base, filters to the same hostname,
dedupes.

## Crawl safety (reused, not new)

`isAllowedByRobots`, `throttle`, and the existing timeout/size limits in
`fetchPageMeta` already exist and already apply per-page. The homepage
fetch for link discovery goes through the same `isAllowedByRobots` check
before extracting links from it.

## What's explicitly out of scope for this slice

Dashboard visual redesign (terminal placement, Site Brief, charts,
platform-icon component), Content Studio wiring changes, and GA4 handling
— these are the master directive's later slice, once this ships and is
verified live per the customer-validation flow (YOKI's own site, since it
has zero search history and is exactly the case this unblocks).

## Testing

- `crawler.ts`: new unit tests for internal-link extraction (relative
  URLs, same-hostname filtering, dedup, malformed HTML).
- `run-scan.ts`: existing GSC-path tests unchanged; new tests for the
  no-GSC path (homepage links + sitemap merge, page budget cap).
- `websites/route.ts`: update the sibling-inheritance tests — `url` must
  no longer move to the sentinel.
- `select-site/route.ts`: update to assert writes land on `gscPropertyUrl`.
- `scan/route.ts`: remove the "no GSC token → 400" test, add "no GSC token
  → scan enqueues successfully."
- New confirm-URL route: happy path, ownership check, rejects a second
  confirmation once already resolved.
