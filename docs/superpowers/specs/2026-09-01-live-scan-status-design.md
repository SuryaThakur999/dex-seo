# Live scan status — design

First of three follow-up passes on the dashboard (`dashboard-finish`, already
merged): live scan status, then historical trend charts, then an animation
polish pass. This spec covers live scan status only.

## Problem

The dashboard's scan-activity timeline is static — it reflects whatever the
server rendered at page load. If a user clicks "Scan now," nothing on the
page changes until they manually reload, even though a `ScanJob` is
progressing through queued → running → completed in the background. There
is no live/push mechanism anywhere in this app (Vercel serverless + a
cron-polled worker at `/api/scan/process`, no websocket or SSE) — the
dashboard needs to fake "live" honestly, via polling, not claim a
push architecture that doesn't exist.

Separately, the final review on `dashboard-finish` flagged and deferred:
"Scan now" silently no-ops if a scan is already queued/running (the API
dedupes with no user-visible signal). This pass closes that gap too, since
it now has the live state needed to drive it.

## Scope

- Live-updating scan-activity timeline while a scan is in flight.
- "Scan now" button disables and relabels during an in-flight scan.
- Stat cards and GrowthGuard breakdown refresh once, when the scan
  completes — not polled independently.

Out of scope: trend charts (next pass), animation polish (pass after that),
any change to the actual scan pipeline/cron worker itself.

## Architecture

**New route:** `src/app/api/scan/status/route.ts` (GET). Returns the
customer's 5 most recent `ScanJob` rows as JSON — same shape
`ScanActivity` already consumes (`id`, `status`, `createdAt`, `completedAt`,
`error`). Middleware's `isProtectedRoute` matcher covers `/api/scan` as an
exact string only (not `/api/scan(.*)`) — deliberate, since the cron worker
at `/api/scan/process` authenticates via `CRON_SECRET`, not Clerk. This new
route is not covered by that exact match, so it checks `auth()` inline
itself, the same defensive pattern `/api/scan/route.ts` already uses even
though it IS middleware-covered.

**New client component:** `src/components/dashboard/live-scan-panel.tsx`
(`'use client'`). Wraps `ScanActivity` and the "Scan now" button/form.
Props: `initialJobs: ScanActivityJob[]`. Server-rendered on first load (no
loading flash) — the page passes the same `recentJobs` it already fetches.

Behavior:
- If the newest job in state is `queued` or `running`, starts a 3-second
  `setInterval` fetching `/api/scan/status` and replacing local job state
  with the response.
- The moment the newest job's status transitions to `completed` or
  `failed`, clears the interval and calls Next's `router.refresh()` once.
  That re-runs the server component (`page.tsx`), so stat cards and
  GrowthGuard breakdown pick up real new numbers — no separate polling for
  those.
- While the newest job is `queued`/`running`, the "Scan now" button is
  `disabled` and its label reads "Scan in progress" instead of "Scan now."
- No new dependency. Plain `fetch` + `setInterval`, matching this
  codebase's existing minimalism (no SWR/react-query used anywhere else).

**Page change:** `src/app/dashboard/page.tsx` replaces its current inline
`<form action="/api/scan">` + `<ScanActivity jobs={recentJobs} />` pairing
with `<LiveScanPanel initialJobs={recentJobs} />`, which now owns both.

## Data flow

1. Server renders the page with real `recentJobs` (unchanged fetch).
2. `LiveScanPanel` hydrates with that data. If nothing is in flight, it
   renders statically and polls nothing — idle dashboards make zero extra
   requests.
3. User clicks "Scan now" → existing `POST /api/scan` behavior (unchanged)
   → the button disables itself locally (optimistic) → panel starts
   polling `/api/scan/status` every 3s.
4. On completion/failure, panel stops polling and triggers one
   `router.refresh()` for the rest of the page.

## Error handling

If `/api/scan/status` fails (network blip, 401 if the session expired
mid-poll), the panel stops polling silently after that fetch attempt fails
rather than retrying forever or throwing — the user can still reload
manually. No error toast for this; a failed poll isn't user-actionable
mid-scan.

## Testing

- `src/app/api/scan/status/route.test.ts` — new: unauthenticated → 401;
  authenticated → returns the customer's own jobs only, ordered newest
  first, capped at 5 (mirrors the existing pattern in
  `src/app/api/scan/route.test.ts`).
- `LiveScanPanel` is a client component with a timer and `fetch` — no
  existing test infra covers client components (no jsdom configured,
  vitest runs `environment: 'node'`). Verified via `npm run build`
  type-check plus a manual `/browse` check: trigger a scan, confirm the
  panel polls (network tab / `console` command) and stops on completion.
