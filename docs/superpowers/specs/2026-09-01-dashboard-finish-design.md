# Dashboard finish — design

## Problem

`src/app/dashboard/page.tsx` is a functional but unstyled scaffold: raw HTML,
one styled link. `/review` and `/settings` already use the app's light design
system (`Card`/`Badge`/`Button` from shadcn, tokens in `globals.css :root`).
The dashboard needs the same treatment, using real data already available in
the schema (no invented metrics).

## Reference

User supplied a CRM dashboard reference (Muzli/Trackify: sidebar nav, stat
cards with sparklines, revenue chart + donut breakdown, data table). Studied
via screenshot. Explicitly not to be cloned: it's a generic purple/indigo SaaS
template with fabricated revenue-style metrics that don't map onto an SEO
tool. Its structural ideas that do apply: stat-card row, a status/activity
view, a breakdown widget, clear tab/section separation.

## Brand decision

Extend Dex's real coral/terminal identity into the authenticated app rather
than keeping the current generic corporate-blue theme (user confirmed).
Concretely:

- Swap `--accent` in `globals.css :root` from `#0369A1` to `#ff4d2e`. This is
  a shared token, so `/review` and `/settings` inherit the fix for free
  (they already reference `--accent` for links/hover borders).
- Add `--font-mono: 'Fira Code', monospace` to the `@theme inline` block so
  `font-mono` becomes a real Tailwind utility. Used only for numerals/data,
  never body copy.
- GrowthGuard badges move from soft pill shapes to sharp-cornered
  (`rounded-sm`), uppercase, tracked-out mono badges — reads as system
  status, not a marketing chip.

## Data (all real, no fabrication)

From `prisma/schema.prisma` + `src/lib/*`:

- `Customer`: `websiteUrl`, `gscRefreshToken` (connection state), `plan`.
- `ScanJob`: `status` (queued/running/completed/failed), timestamps,
  `resultSummary`, `error` — powers the activity timeline.
- `Action` + `GuardResult`: `status` (pending/approved/edited), `outcome`
  (pass/flag/block) — powers stat counts and the GrowthGuard breakdown.
- `tokenCost` on `Action` — sums to a real spend figure.

No time-series revenue/sales data exists in this schema (it's an SEO tool,
not a CRM) — the design deliberately has no line chart or donut standing in
for data that isn't there.

## Layout

1. **Header** — site URL, connection-status pill, last-scan timestamp, one
   primary "Scan now" button (coral).
2. **Stat row** (4 cards, dense grid dial): Pages scanned · Drafts pending
   review · GrowthGuard catches (blocked + flagged) · Tokens spent. Fira Code
   numerals, real DB aggregates.
3. **Two-column mid-section**:
   - Left: scan-activity timeline from `ScanJob` rows (status badges, a
     live pulse dot only while `status: running`).
   - Right: GrowthGuard breakdown — real pass/flag/block counts as a
     colored bar-list, linking to `/review`.
4. **Footer row** — links to Review queue (live pending count) and Settings.
5. **Empty states**: not connected → coral connect CTA. Connected, no site
   chosen → existing site picker, restyled. Connected, never scanned → a
   one-line first-scan prompt.

## Motion

Critically damped only (`damping 1.0`), nothing decorative: press-scale on
buttons/cards (0.97, on pointerdown), a light staggered fade-up on stat cards
on mount (~60ms stagger), the scan-status pulse dot. All collapse to a static
state under `prefers-reduced-motion`.

## Scope

- `src/app/dashboard/page.tsx` — rebuilt.
- `src/components/dashboard/stat-card.tsx` — new.
- `src/components/dashboard/scan-activity.tsx` — new.
- `src/components/dashboard/guard-breakdown.tsx` — new.
- `src/app/globals.css` — token changes (`--accent`, `--font-mono`).
- No schema changes, no new dependencies.

## Testing

- `npm test` (vitest) must stay green — no existing test touches the
  dashboard page today, so no regression risk there.
- `npm run build` must succeed (type-check + Next build).
- Visual check via `/browse` at 1440px, mobile (375px), and dark/light
  states of connection (not-connected / site-picker / scanned).

## Out of scope

- No `/review` or `/settings` visual rework beyond the free token cascade.
- No new database fields or migrations.
- No sidebar nav (single-page app today, not a multi-section shell — adding
  one is a separate decision, not bundled into this pass).
