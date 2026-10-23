# Live Scan Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a running scan a real, narrated terminal-style log — every line traces to an actual checkpoint already executing in `run-scan.ts`, nothing fabricated, no credit counter, no state that can end in a silent stuck spinner.

**Architecture:** A new `ScanLogLine` table records short messages tied to a `ScanJob`. `run-scan.ts` writes a line at each real checkpoint it already passes through. `process/route.ts` writes the opening and closing lines (only it knows the job's final status). `/api/scan/status`, already polled every 3 seconds by `LiveScanPanel`, returns the newest job's lines alongside the existing job list — no new polling loop. A new `ScanTerminal` component renders them in the dark/monospace register the rest of the app already uses.

**Tech Stack:** Prisma (new model + migration), Next.js App Router route handlers, React client component, Vitest with the codebase's existing `vi.mock('@/lib/db', ...)` convention (no real test database — every existing test in `run-scan.test.ts`, `process/route.test.ts`, and `status/route.test.ts` mocks `db` directly).

## Global Constraints

- No new npm dependency.
- No user-facing credit/quota counter — `tokenCost` stays internal, never surfaced as a currency the user spends (see the design's explicit reasoning for not copying that part of Okara's UI).
- No new polling loop — `logLines` piggybacks on `LiveScanPanel`'s existing 3-second `/api/scan/status` poll.
- `scanJobId` on `runScanForCustomer` is optional — existing direct calls in tests without a job id must keep compiling and behaving exactly as before (logging becomes a no-op, not an error).
- Every test file in this plan already fully mocks `@/lib/db` — there is no real test database in this codebase's convention. Match that pattern exactly; do not introduce a real DB connection in a test.

---

### Task 1: `ScanLogLine` migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `db.scanLogLine.create({ data: { scanJobId, message } })`, `db.scanLogLine.findMany(...)` — standard Prisma Client methods generated from this model, consumed by Tasks 2-4.

- [ ] **Step 1: Add the model and back-relation**

In `prisma/schema.prisma`, add `logLines ScanLogLine[]` to the existing `ScanJob` model (after its `error String?` line), and add a new model after `ScanJob`:

```prisma
model ScanLogLine {
  id         String   @id @default(cuid())
  scanJobId  String
  scanJob    ScanJob  @relation(fields: [scanJobId], references: [id])
  message    String
  createdAt  DateTime @default(now())
}
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add_scan_log_line`
Expected: migration applies cleanly against the local dev database, and Prisma Client regenerates with `db.scanLogLine` available.

- [ ] **Step 3: Confirm the client picked it up**

Run: `npx tsc --noEmit`
Expected: PASS (this alone won't catch a missing generated client, but confirms nothing else broke; Task 2's test will be the real signal that `db.scanLogLine` exists on the generated client type)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat: add ScanLogLine model for real-time scan step narration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 2: Instrument `run-scan.ts` at its real checkpoints

**Files:**
- Modify: `src/lib/run-scan.ts`
- Test: `src/lib/run-scan.test.ts`

**Interfaces:**
- Consumes: `db.scanLogLine.create` from Task 1
- Produces: `runScanForCustomer(customer: Customer, scanJobId?: string): Promise<ScanResult>` — same return type as today, one new optional trailing parameter. Callers that omit it (all current tests) are unaffected.

- [ ] **Step 1: Add `scanLogLine` to the test file's db mock**

In `src/lib/run-scan.test.ts`, change the `vi.mock('@/lib/db', ...)` block from:

```typescript
vi.mock('@/lib/db', () => ({
  db: {
    action: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    pageSnapshot: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
```

to:

```typescript
vi.mock('@/lib/db', () => ({
  db: {
    action: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    pageSnapshot: { findUnique: vi.fn(), upsert: vi.fn() },
    scanLogLine: { create: vi.fn() },
  },
}));
```

- [ ] **Step 2: Write the failing test**

Add this new test to the existing `describe('runScanForCustomer — sitemap quota', ...)` block in `src/lib/run-scan.test.ts` (it only needs the sitemap-quota fixtures, not the content-drift ones):

```typescript
  it('logs a step line for the pages-found checkpoint when a scanJobId is provided', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(3));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, 'job_123');

    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_123', message: 'Found 3 pages to check.' },
    });
  });

  it('does not call scanLogLine.create when no scanJobId is given', async () => {
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue(gscPages(3));
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER);

    expect(db.scanLogLine.create).not.toHaveBeenCalled();
  });
```

Also add one assertion to the existing `'drafts and upserts a fresh snapshot when no snapshot exists yet'` test (in the `describe('runScanForCustomer — content drift baseline', ...)` block) — read that test first to see its exact existing mock setup, then add after its existing assertions:

```typescript
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_123', message: 'GrowthGuard: pass — https://example.com/gsc-0' },
    });
```

and change that test's `runScanForCustomer(CUSTOMER)` call to `runScanForCustomer(CUSTOMER, 'job_123')` — adjust the exact URL/outcome in the assertion above to match whatever that specific existing test's mocked `runGrowthGuard` return value and page URL actually are (read the test before writing this assertion; don't guess the values).

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `npx vitest run src/lib/run-scan.test.ts`
Expected: FAIL — `db.scanLogLine.create` was not called (function doesn't exist yet in `run-scan.ts`)

- [ ] **Step 4: Implement**

In `src/lib/run-scan.ts`, add a helper near the top (after `computeContentHash`):

```typescript
async function logStep(scanJobId: string | undefined, message: string): Promise<void> {
  if (!scanJobId) return;
  await db.scanLogLine.create({ data: { scanJobId, message } });
}
```

Change the function signature:

```typescript
export async function runScanForCustomer(customer: Customer, scanJobId?: string): Promise<ScanResult> {
```

Insert `logStep` calls at these exact points:

After the `Promise.all` that fetches `gscPerformance`/`sitemapUrls` and the `performance` array is assembled (right before `const snapshots: GrowthBrainPageSnapshot[] = [];`):

```typescript
  await logStep(scanJobId, `Found ${performance.length} pages to check.`);
```

Inside the `for (const page of performance)` loop, as the first line of the loop body:

```typescript
  for (const page of performance) {
    await logStep(scanJobId, `Checking ${page.url}...`);
    const meta = await fetchPageMeta(page.url);
```

After `const flagged = flagPages(snapshots).slice(0, MAX_DRAFTS_PER_SCAN);`:

```typescript
  await logStep(scanJobId, `Found ${flagged.length} page(s) worth fixing.`);
```

Inside the `for (const page of flagged)` loop, at each of the three existing `continue` branches (already-pending, recently-decided, unchanged-content), add a line immediately before each `continue`:

```typescript
    if (alreadyPending) {
      await logStep(scanJobId, `Skipping ${page.url} (already has a pending draft).`);
      continue;
    }
```

```typescript
    if (recentlyDecided) {
      await logStep(scanJobId, `Skipping ${page.url} (recently reviewed).`);
      continue;
    }
```

```typescript
    if (existingSnapshot && existingSnapshot.contentHash === contentHash) {
      await logStep(scanJobId, `Skipping ${page.url} (content unchanged since last check).`);
      continue;
    }
```

Inside the `try` block, right before `const { draftContent, tokenCost } = await draftMetaDescription(...)`:

```typescript
      await logStep(scanJobId, `Drafting a fix for ${page.url}...`);
```

Right after `const guardResult = runGrowthGuard(...)`:

```typescript
      await logStep(scanJobId, `GrowthGuard: ${guardResult.outcome} — ${page.url}`);
```

In the `catch (err)` block, alongside the existing `console.error` and `errors.push`:

```typescript
    } catch (err) {
      console.error('Draft/guard failed for', page.url, err);
      await logStep(scanJobId, `Couldn't process ${page.url}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      errors.push({ url: page.url, error: err instanceof Error ? err.message : 'Unknown error' });
      continue;
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/run-scan.test.ts`
Expected: PASS, all tests including the pre-existing ones

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/run-scan.ts src/lib/run-scan.test.ts
git commit -m "$(cat <<'EOF'
feat: instrument run-scan.ts with real step-by-step log lines

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 3: Wire `process/route.ts` — opening and closing lines

**Files:**
- Modify: `src/app/api/scan/process/route.ts`
- Test: `src/app/api/scan/process/route.test.ts`

**Interfaces:**
- Consumes: `runScanForCustomer(customer, scanJobId?)` from Task 2 — now called with the job's id as the second argument.
- Consumes: `db.scanLogLine.create` from Task 1.

- [ ] **Step 1: Add `scanLogLine` to the test file's db mock, and `websiteUrl` to its customer fixtures**

In `src/app/api/scan/process/route.test.ts`, change the mock block:

```typescript
vi.mock('@/lib/db', () => ({
  db: {
    scanJob: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    scanLogLine: { create: vi.fn() },
  },
}));
```

In the `'runs the scan for the oldest queued job and marks it completed'` test, change the mocked job to include a website URL (needed for the new opening log line):

```typescript
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'job_1',
      customer: { id: 'cust_1', websiteUrl: 'https://example.com' },
    });
```

Do the same in the `'marks the job failed when runScanForCustomer throws'` test's `findFirst` mock.

- [ ] **Step 2: Write the failing test**

Add to the `'runs the scan for the oldest queued job and marks it completed'` test, after its existing assertions:

```typescript
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_1', message: 'Starting scan for https://example.com...' },
    });
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_1', message: 'Scan complete — 3 pages checked, 1 draft created.' },
    });
    expect(runScanForCustomer).toHaveBeenCalledWith({ id: 'cust_1', websiteUrl: 'https://example.com' }, 'job_1');
```

Add to the `'marks the job failed when runScanForCustomer throws'` test, after its existing assertions:

```typescript
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_1', message: 'Scan failed: GSC token revoked' },
    });
```

- [ ] **Step 3: Run the tests to verify the new assertions fail**

Run: `npx vitest run src/app/api/scan/process/route.test.ts`
Expected: FAIL — `db.scanLogLine.create` not called with the expected arguments (route doesn't call it yet)

- [ ] **Step 4: Implement**

In `src/app/api/scan/process/route.ts`, right after the `claimed.count === 0` early return (i.e., once the job is confirmed claimed), add:

```typescript
  await db.scanLogLine.create({
    data: { scanJobId: job.id, message: `Starting scan for ${job.customer.websiteUrl}...` },
  });
```

Change the `runScanForCustomer` call to pass the job id:

```typescript
    const result = await runScanForCustomer(job.customer, job.id);
```

Right after the success-path `db.scanJob.update` call (inside the `try` block, after it resolves):

```typescript
    await db.scanLogLine.create({
      data: {
        scanJobId: job.id,
        message: `Scan complete — ${result.pagesScanned} pages checked, ${result.draftsCreated} draft${result.draftsCreated === 1 ? '' : 's'} created.`,
      },
    });
```

Right after the failure-path `db.scanJob.update` call (inside the `catch` block, after it resolves):

```typescript
    await db.scanLogLine.create({
      data: { scanJobId: job.id, message: `Scan failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/scan/process/route.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/api/scan/process/route.ts src/app/api/scan/process/route.test.ts
git commit -m "$(cat <<'EOF'
feat: log scan opening/closing lines from process/route.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 4: `/api/scan/status` returns `logLines`

**Files:**
- Modify: `src/app/api/scan/status/route.ts`
- Test: `src/app/api/scan/status/route.test.ts`

**Interfaces:**
- Consumes: `db.scanLogLine.findMany` from Task 1
- Produces: response shape `{ jobs: [...existing shape...], logLines: { id: string; message: string; createdAt: string }[] }` — `logLines` is the newest job's lines, oldest-first, capped at 20. Consumed by Task 6 (`LiveScanPanel`).

- [ ] **Step 1: Add `scanLogLine` to the test file's db mock**

In `src/app/api/scan/status/route.test.ts`:

```typescript
vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    scanJob: { findMany: vi.fn() },
    scanLogLine: { findMany: vi.fn() },
  },
}));
```

- [ ] **Step 2: Write the failing test**

Add to the existing `describe('GET /api/scan/status', ...)` block:

```typescript
  it("includes the newest job's log lines, oldest first, capped at 20", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust_1' });
    const jobs = [{ id: 'job_2', status: 'running', createdAt: new Date('2026-01-02'), completedAt: null, error: null }];
    (db.scanJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(jobs);
    const lines = [{ id: 'line_1', message: 'Found 3 pages to check.', createdAt: new Date('2026-01-02T00:00:01Z') }];
    (db.scanLogLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(lines);

    const res = await GET();
    const body = await res.json();

    expect(db.scanLogLine.findMany).toHaveBeenCalledWith({
      where: { scanJobId: 'job_2' },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, message: true, createdAt: true },
    });
    expect(body.logLines).toHaveLength(1);
    expect(body.logLines[0].message).toBe('Found 3 pages to check.');
  });

  it('returns an empty logLines array when there are no jobs', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust_1' });
    (db.scanJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(db.scanLogLine.findMany).not.toHaveBeenCalled();
    expect(body.logLines).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/scan/status/route.test.ts`
Expected: FAIL — `body.logLines` is `undefined`

- [ ] **Step 4: Implement**

Replace the full contents of `src/app/api/scan/status/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Unauthorized', { status: 401 });

  const jobs = await db.scanJob.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, status: true, createdAt: true, completedAt: true, error: true },
  });

  const logLines = jobs[0]
    ? await db.scanLogLine.findMany({
        where: { scanJobId: jobs[0].id },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { id: true, message: true, createdAt: true },
      })
    : [];

  return NextResponse.json({ jobs, logLines });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/scan/status/route.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/api/scan/status/route.ts src/app/api/scan/status/route.test.ts
git commit -m "$(cat <<'EOF'
feat: return newest job's log lines from /api/scan/status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 5: `ScanTerminal` component

**Files:**
- Create: `src/components/dashboard/scan-terminal.tsx`

**Interfaces:**
- Produces: `ScanTerminal({ lines, running }: { lines: { id: string; message: string }[]; running: boolean })` — client component. `lines[0]` renders with a `$` prefix, every other line with `>`. A blinking block cursor renders after the last line only while `running` is true.

- [ ] **Step 1: Create the component**

```typescript
'use client';

export function ScanTerminal({
  lines,
  running,
}: {
  lines: { id: string; message: string }[];
  running: boolean;
}) {
  if (lines.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-[var(--dex-app-bg-elevated-2)] px-4 py-3 font-mono text-xs text-foreground">
      {lines.map((line, i) => (
        <div key={line.id} className="leading-relaxed">
          <span className="text-muted-foreground">{i === 0 ? '$' : '>'}</span> {line.message}
        </div>
      ))}
      {running && (
        <span
          className="mt-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
```

`--dex-app-bg-elevated-2` is the existing elevated-surface token already defined in `globals.css`'s `.dex-app` block. `animate-pulse` is a built-in Tailwind animation utility (no new CSS needed); `motion-reduce:animate-none` respects `prefers-reduced-motion` per this codebase's existing accessibility conventions.

- [ ] **Step 2: Run the test suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS (no dedicated unit test for this presentational component — same convention as `Sparkline`/`MiniBarChart`/`ComparisonBar` from the prior dashboard rebuild, all visually verified rather than unit-tested; Task 7 covers this one)

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/scan-terminal.tsx
git commit -m "$(cat <<'EOF'
feat: add ScanTerminal component for live scan step narration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 6: Wire `ScanTerminal` into `LiveScanPanel`

**Files:**
- Modify: `src/components/dashboard/live-scan-panel.tsx`

**Interfaces:**
- Consumes: `ScanTerminal` from Task 5; the `logLines` field from `/api/scan/status` (Task 4).

- [ ] **Step 1: Extend the polled state and response handling**

In `src/components/dashboard/live-scan-panel.tsx`, add an import:

```typescript
import { ScanTerminal } from '@/components/dashboard/scan-terminal';
```

Add a `logLines` piece of state alongside the existing `jobs` state:

```typescript
  const [logLines, setLogLines] = useState<{ id: string; message: string }[]>([]);
```

In the `poll` function, change:

```typescript
        const data: { jobs: RawJob[] } = await res.json();
        const nextJobs = parseJobs(data.jobs);
        setJobs(nextJobs);
```

to:

```typescript
        const data: { jobs: RawJob[]; logLines: { id: string; message: string }[] } = await res.json();
        const nextJobs = parseJobs(data.jobs);
        setJobs(nextJobs);
        setLogLines(data.logLines);
```

- [ ] **Step 2: Render it above the existing job-history list**

Change the component's `return` statement from:

```typescript
  return (
    <ScanActivity
      jobs={jobs}
      headerAction={...}
      statusMessage={...}
    />
  );
```

to:

```typescript
  return (
    <div className="flex flex-col gap-4">
      {jobs.length > 0 && <ScanTerminal lines={logLines} running={inFlight} />}
      <ScanActivity
        jobs={jobs}
        headerAction={
          <form action="/api/scan" method="post">
            <Button type="submit" variant="accent" disabled={inFlight}>
              <ArrowsClockwise size={16} weight="regular" className="mr-2" aria-hidden="true" />
              {inFlight ? 'Scan in progress' : 'Scan now'}
            </Button>
          </form>
        }
        statusMessage={pollError && <p className="text-xs text-destructive">{pollError}</p>}
      />
    </div>
  );
```

(Keep the existing `headerAction` and `statusMessage` JSX exactly as they were — only the wrapping `<div>` and the new `<ScanTerminal>` line are new.)

- [ ] **Step 3: Run the test suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/live-scan-panel.tsx
git commit -m "$(cat <<'EOF'
feat: wire ScanTerminal into LiveScanPanel's existing poll loop

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 7: Visual verification — a real triggered scan

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Sign in and trigger a real scan**

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto "http://localhost:3000/dashboard"
```

Sign in with the founder's real dev account if not already authenticated. Confirm a customer with a connected Search Console and a selected site exists (required for `runScanForCustomer` to work at all — it throws otherwise). Click "Scan now", or:

```bash
$B click "button:has-text('Scan now')"
```

- [ ] **Step 3: Watch the terminal populate live, not just the final state**

```bash
$B screenshot /tmp/dex-scan-terminal-1.png
```

Read the screenshot. It won't show much yet — the scan is asynchronous (processed by the `/api/scan/process` cron endpoint, not inline). If nothing is running yet, manually trigger one processing tick against the local dev server (the cron endpoint requires the `CRON_SECRET` bearer token from `.env.local`):

```bash
source .env.local
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/scan/process
```

Wait a few seconds for `LiveScanPanel`'s 3-second poll to pick up the change, then screenshot again:

```bash
$B screenshot /tmp/dex-scan-terminal-2.png
```

- [ ] **Step 4: Verify the terminal's content and behavior**

Read both screenshots. Confirm: the terminal card renders in the dark elevated surface with monospace text, the first line has a `$` prefix and the rest have `>`, the lines read as a real narrated sequence (found pages, checking each one, drafting, GrowthGuard outcome), a blinking cursor is visible while a job is still `running`/`queued`, and once the job reaches `completed` or `failed` the cursor disappears and the last line is one of the two real completion messages from Task 3 — never a state with no exit.

- [ ] **Step 5: Check console and network for errors**

```bash
$B console --errors
$B network
```
Expected: no errors, no failed requests, and specifically confirm `/api/scan/status` responses include a non-empty `logLines` array while the job is in flight

- [ ] **Step 6: Stop the dev server**

Kill the background `npm run dev` process.
