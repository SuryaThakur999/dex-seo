# Live scan terminal — design

## Problem

While looking at a real reviewer's screenshot of Okara's actual logged-in
product (not their marketing site — see the companion spec,
`2026-09-06-growthguard-review-shell-design.md`, for the source), the user
asked for a working version of the same idea: a live, narrated terminal log
of what the agent is doing right now, in the same dark/monospace register
Dex already uses (`--font-mono: 'Fira Code'` is already wired into
`globals.css` for numerals/data, per the original dashboard-finish design).

Today, `LiveScanPanel` (`src/components/dashboard/live-scan-panel.tsx`)
polls `/api/scan/status` every 3 seconds and shows only job-level status —
queued, running, completed, failed — via `ScanActivity`'s badge list. A
user watching a scan run sees a "Scan in progress" button and nothing else
move for up to a minute (`maxDuration = 60` in
`src/app/api/scan/process/route.ts`) until the badge flips.

## What Okara's real version does, and why not to copy it as-is

The reviewer's screenshot (tribechat.com, tested live) shows Okara's "AI CMO
Terminal": prompt-style lines (`$ Initializing AI CMO...`, `> Let me take a
look at tribechat.com...`), a credit counter, a pixel-mascot icon — then,
in the same screenshot, a silent credit-limit error mid-run, the counter
still reading "5 Credits" while blocked, and a loading spinner
("Loading Company Info / Analyzing your website...") left stuck with no
explanation.

Two things carry over, two don't:

- **Carries over:** the narrated, terminal-styled log of real steps as they
  happen. It's a genuinely good pattern — watching an agent work is more
  trustworthy than a spinner.
- **Carries over:** the dark/monospace visual register — Dex already has
  the font token for this.
- **Does not carry over:** a credit counter. Dex has no user-facing credit
  system (`tokenCost` is tracked internally on `Action`, never surfaced as
  a currency the user spends) — inventing one to look more like Okara would
  be adding fake product surface, the exact anti-pattern this whole
  exercise (see the council report artifact from earlier this session)
  argues against.
- **Does not carry over:** any risk of a silent, contradictory, or stuck
  state. Every line in this design traces to a real, already-executing
  step in `run-scan.ts` — nothing is narrated that isn't actually
  happening, and the terminal always ends on a real terminal state
  (completed or failed), never a spinner with no exit.

## Design

### New table: `ScanLogLine`

```prisma
model ScanLogLine {
  id         String   @id @default(cuid())
  scanJobId  String
  scanJob    ScanJob  @relation(fields: [scanJobId], references: [id])
  message    String
  createdAt  DateTime @default(now())
}
```

Add `logLines ScanLogLine[]` to `ScanJob`. A new migration
(`npx prisma migrate dev`) is required — this is the one piece of this
design that touches the database, everything else is application code
reading/writing through the existing Prisma client.

### Instrumentation in `run-scan.ts`

`runScanForCustomer(customer: Customer)` becomes
`runScanForCustomer(customer: Customer, scanJobId?: string)`. A small
internal helper:

```typescript
async function logStep(scanJobId: string | undefined, message: string): Promise<void> {
  if (!scanJobId) return;
  await db.scanLogLine.create({ data: { scanJobId, message } });
}
```

`scanJobId` stays optional so the existing test suite's direct calls to
`runScanForCustomer(customer)` (no job id) keep working unchanged — logging
is a no-op without one, not a required argument.

Calls inserted at the real checkpoints already in the function, in order:

1. After the `Promise.all` GSC/sitemap fetch: `` `Found ${performance.length} pages to check.` ``
2. Inside the `fetchPageMeta` loop, once per page: `` `Checking ${page.url}...` ``
3. After `flagPages`: `` `Found ${flagged.length} page(s) worth fixing.` ``
4. Inside the drafting loop: `` `Drafting a fix for ${page.url}...` `` before
   `draftMetaDescription`, then after `runGrowthGuard`:
   `` `GrowthGuard: ${guardResult.outcome} — ${page.url}` ``
5. On a skip (already-pending, cooldown, unchanged content — the three
   `continue` branches before the try block): a single terse line per skip
   reason, e.g. `` `Skipping ${page.url} (recently reviewed).` `` — this is
   what makes "20 pages found, 3 drafts created" honest instead of
   confusing.
6. On the catch branch (existing `console.error`): also
   `` `Couldn't process ${page.url}: ${message}` ``
7. Return value unchanged — the caller (`process/route.ts`) logs the final
   line, not `run-scan.ts`, since only the caller knows the job's terminal
   status.

### `process/route.ts` changes

- Right after the job is successfully claimed (`claimed.count === 1`):
  `` `Starting scan for ${job.customer.websiteUrl}...` `` — the opening
  line, matching Okara's `$ Initializing...` moment but naming the real
  site being scanned.
- Pass `job.id` into `runScanForCustomer(job.customer, job.id)`.
- On success, after the `scanJob.update` to `completed`:
  `` `Scan complete — ${result.pagesScanned} pages checked, ${result.draftsCreated} drafts created.` ``
- On failure, after the `scanJob.update` to `failed`:
  `` `Scan failed: ${message}` `` — this is the line Okara's test never
  got to show; a failure here is loud and explained, not a stuck spinner.

### `/api/scan/status` response

Add one field: the 20 most recent `ScanLogLine` rows for `jobs[0]` only
(the current/most recent job — older jobs' logs aren't needed for a live
view), ordered oldest-first so they read top-to-bottom like a real log:

```typescript
const logLines = jobs[0]
  ? await db.scanLogLine.findMany({
      where: { scanJobId: jobs[0].id },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, message: true, createdAt: true },
    })
  : [];

return NextResponse.json({ jobs, logLines });
```

### New component: `ScanTerminal`

`src/components/dashboard/scan-terminal.tsx` — a client component, dark
terminal card using the `.dex-app` scope's existing elevated-surface token
(`--dex-app-bg-elevated-2`) and `font-mono` (already Fira Code via the
`@theme inline` block). Renders the `logLines` array, one per line, each
prefixed `>` except the first line of a job which gets `$`. While the job
is in flight (`running`/`queued`, same `IN_FLIGHT_STATUSES` set
`LiveScanPanel` already has), a blinking block cursor renders after the
last line via a CSS animation respecting `prefers-reduced-motion`; once the
job reaches a terminal status the cursor is removed and the last line is
always one of the two real completion lines from `process/route.ts` —
there is no state where the terminal is showing a spinner with nothing
behind it.

### Wiring into `LiveScanPanel`

`LiveScanPanel` already polls `/api/scan/status` every 3 seconds and holds
`jobs` in state. Add `logLines` to the same state, updated from the same
poll response (no second polling loop, no new interval) — extend `RawJob`
handling to also capture `data.logLines`, and render
`<ScanTerminal lines={logLines} running={inFlight} />` above the existing
`<ScanActivity .../>` job-history list, only when `jobs.length > 0` (no
terminal shown before a customer's first-ever scan — matches the existing
"no scans yet" empty state on the dashboard, untouched).

## Testing

`logStep` and the new checkpoint calls are exercised by extending
`run-scan.test.ts`'s existing test database fixtures: pass a `scanJobId`
into `runScanForCustomer` in at least one existing test case and assert
the resulting `ScanLogLine` rows exist with the expected messages, in
order, for the found-pages / flagged / drafted / guard-outcome checkpoints.
The skip-reason and catch-branch lines get one test each, matching the
existing test file's per-branch coverage style (it already has dedicated
tests per skip reason and per error path). `/api/scan/status`'s new
`logLines` field gets one test in its existing route test file, asserting
the 20-row cap and ascending order. `ScanTerminal` is presentational —
visual verification via the `browse` skill against the dev server, same
pattern as prior UI work this session, triggering a real scan and watching
the terminal populate live rather than mocking the poll.
