# Verified on next scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Addendum (2026-10-17, after overseer review of commit 557cec5):** two gaps were flagged before Task 1 started -- both are folded into this plan below and were implemented alongside Tasks 1-7 rather than as a plan rewrite, since the correction arrived mid-build (see memory.md for the full timeline of the sequencing miss). (1) Task 5 originally only normalized the bare-domain-vs-`/` collision at the *matching* stage (`normalizePageUrlForRescan`, Task 2) -- that cleans up old duplicate findings already in the DB but does nothing to stop the crawler from creating new duplicates. Fixed at the actual page-enumeration choke point in `run-scan.ts` (where the GSC and non-GSC discovery paths converge, right before the per-page loop), not only in the matcher. (2) Added Task 8 below: a weekly cron (`/api/cron/weekly-rescan`) so verification runs without anyone pressing "Run audit" -- reuses the existing `enqueueScanIfNeeded` dedup-aware helper, no new scan mechanism.

**Goal:** After every completed scan, compare each website's previously-open `Finding` rows against what the new scan actually observed on that same page, and record `fixed` / `excluded` / `could_not_verify` — without touching `ActionStatus` — so Outcomes can show a "Verified fixes" block even on sites with no GSC connection.

**Architecture:** A new pure-function core (`src/lib/verified-on-rescan.ts`) decides the outcome for one (prior finding, current page observation) pair. `run-scan.ts` calls it once per crawled page, using signals it already computes (`fetchHtmlWithStatus`'s `status`/`blockedByRobots`, `hasNoindexMeta`, and the rule IDs the SEO Specialist just fired on that page) — no second crawl, no new persisted crawl-result table. A second pass after the page loop resolves pages the scan never reached this run to `could_not_verify`. The Review query gets one additional filter; Outcomes gets one new component.

**Tech Stack:** Next.js 14 App Router, Prisma/Postgres (Neon), Vitest.

## Global Constraints

- Schema change is additive only, all three new `Finding` fields nullable, human already approved it (`docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md`).
- Migration runs ONLY against the dev branch `ep-long-truth` via an explicit `DATABASE_URL` override. Never `.env.local`. Never `dangerouslyDisableSandbox` on any DB command. Production migration happens only at deploy time via the overseer with the human's separate yes.
- `ActionStatus` and `Action.decidedAt` are never written by this feature — resolving findings is an observation, not a human decision.
- `could_not_verify` never counts as fixed anywhere (Outcomes counts, Review filter).
- Tests first (superpowers:test-driven-development) for every task below.
- Tier 2 design rule applies to the Outcomes "Verified fixes" block (Task 7). Needs overseer screenshots: `/dashboard/[websiteId]` Outcomes tab, at 320px, 768px, 1280px.

---

### Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma` (`model Finding`, lines 658-682)
- Create: `prisma/migrations/<timestamp>_add_finding_resolution/migration.sql` (via `prisma migrate dev`)

**Interfaces:**
- Produces: `Finding.resolvedAt: DateTime | null`, `Finding.resolvedByScanJobId: string | null`, `Finding.resolution: string | null`, index `@@index([websiteId, resolvedAt])` — consumed by Tasks 4, 6, 7.

- [ ] **Step 1: Add the fields to the Prisma schema**

```prisma
model Finding {
  id              String          @id @default(cuid())
  customerId      String
  customer        Customer        @relation(fields: [customerId], references: [id])
  websiteId       String
  website         Website         @relation(fields: [websiteId], references: [id])
  scanJobId       String?
  scanJob         ScanJob?        @relation(fields: [scanJobId], references: [id])
  pageUrl         String
  agent           String
  ruleId          String
  ruleVersion     String          @default("v1")
  severity        FindingSeverity
  confidence      String
  evidence        Json
  limitations     String?
  suggestedAction String
  retrievedAt     DateTime        @default(now())
  createdAt       DateTime        @default(now())
  // Verified-on-rescan (docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md): all
  // three nullable, additive only. resolution is a tri-state descriptor, NOT the same as
  // "resolved" -- could_not_verify sets resolution but leaves resolvedAt/resolvedByScanJobId
  // null, so the finding still counts as open.
  resolvedAt           DateTime?
  resolvedByScanJobId  String?
  resolution           String? // 'fixed' | 'excluded' | 'could_not_verify'
  provenanceLinks ActionProvenanceFinding[]
  contentPieces   ContentPiece[]

  @@index([websiteId])
  @@index([scanJobId])
  @@index([websiteId, resolvedAt])
}
```

- [ ] **Step 2: Generate the migration against the dev branch only**

```bash
DATABASE_URL="<ep-long-truth connection string from .env.generation-status-dev>" npx prisma migrate dev --name add_finding_resolution --schema prisma/schema.prisma
```

Confirm in the output that the connection host is `ep-long-truth` before approving the prompt. Never run this without the explicit override -- `.env.local` is read-only and frozen per the standing DB-freeze incident note.

- [ ] **Step 3: Verify the migration applied cleanly**

```bash
DATABASE_URL="<ep-long-truth>" npx prisma migrate status --schema prisma/schema.prisma
```

Expected: "Database schema is up to date!", no drift.

- [ ] **Step 4: Regenerate the Prisma client**

```bash
npx prisma generate --schema prisma/schema.prisma
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add Finding.resolvedAt/resolvedByScanJobId/resolution (verified-on-rescan)"
```

---

### Task 2: Page-URL matching key

**Files:**
- Create: `src/lib/verified-on-rescan.ts`
- Test: `src/lib/verified-on-rescan.test.ts`

**Interfaces:**
- Produces: `normalizePageUrlForRescan(url: string): string` -- consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { normalizePageUrlForRescan } from './verified-on-rescan';

describe('normalizePageUrlForRescan', () => {
  it('lowercases the host but keeps path case', () => {
    expect(normalizePageUrlForRescan('https://Example.COM/Blog/Post')).toBe('https://example.com/Blog/Post');
  });
  it('treats the bare domain and / as the same page', () => {
    expect(normalizePageUrlForRescan('https://example.com')).toBe(normalizePageUrlForRescan('https://example.com/'));
  });
  it('strips a trailing slash on a non-root path', () => {
    expect(normalizePageUrlForRescan('https://example.com/blog/')).toBe(normalizePageUrlForRescan('https://example.com/blog'));
  });
  it('strips the fragment', () => {
    expect(normalizePageUrlForRescan('https://example.com/blog#section')).toBe(normalizePageUrlForRescan('https://example.com/blog'));
  });
  it('returns the raw input unchanged if it is not a parseable URL', () => {
    expect(normalizePageUrlForRescan('not-a-url')).toBe('not-a-url');
  });
});
```

- [ ] **Step 2: Run, confirm fails** -- `npx vitest run src/lib/verified-on-rescan.test.ts` -- expected: module not found.

- [ ] **Step 3: Implement**

```typescript
export function normalizePageUrlForRescan(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    } else if (parsed.pathname === '') {
      parsed.pathname = '/';
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}
```

Using `origin + pathname + search` directly (instead of `.toString()`) avoids `URL`'s own trailing-slash-on-bare-domain re-insertion -- verify empirically in Step 4 that both `https://example.com` and `https://example.com/` serialize identically (`https://example.com/`).

- [ ] **Step 4: Run, confirm passes** -- all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/verified-on-rescan.ts src/lib/verified-on-rescan.test.ts
git commit -m "feat(verified-on-rescan): add page-URL matching key normalizer"
```

---

### Task 3: Outcome decision (pure function)

**Files:**
- Modify: `src/lib/verified-on-rescan.ts`
- Modify: `src/lib/verified-on-rescan.test.ts`

**Interfaces:**
- Consumes: nothing external.
- Produces: `type RescanResolution = 'fixed' | 'excluded' | 'could_not_verify'`, `resolveFindingOutcome(input: { ruleStillFires: boolean; httpStatus: number | null; blockedByRobots: boolean; noindex: boolean }): RescanResolution | null` -- consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```typescript
import { resolveFindingOutcome } from './verified-on-rescan';

describe('resolveFindingOutcome', () => {
  const base = { ruleStillFires: false, httpStatus: 200, blockedByRobots: false, noindex: false };

  it('returns fixed when the page is 200, reachable, indexable, and the rule no longer fires', () => {
    expect(resolveFindingOutcome(base)).toBe('fixed');
  });
  it('returns null (still found) when the rule still fires on a healthy page', () => {
    expect(resolveFindingOutcome({ ...base, ruleStillFires: true })).toBeNull();
  });
  it('returns excluded when robots.txt now disallows the page, even if the rule would still fire', () => {
    expect(resolveFindingOutcome({ ...base, ruleStillFires: true, blockedByRobots: true })).toBe('excluded');
  });
  it('returns excluded when the page is now noindex', () => {
    expect(resolveFindingOutcome({ ...base, ruleStillFires: true, noindex: true })).toBe('excluded');
  });
  it.each([401, 403, 404, 500, 503])('returns could_not_verify for HTTP %i', (httpStatus) => {
    expect(resolveFindingOutcome({ ...base, httpStatus })).toBe('could_not_verify');
  });
  it('returns could_not_verify when there is no status at all (timeout/network failure)', () => {
    expect(resolveFindingOutcome({ ...base, httpStatus: null })).toBe('could_not_verify');
  });
  it('never reports fixed for a page that could not be verified, even if the rule check was skipped', () => {
    expect(resolveFindingOutcome({ ...base, httpStatus: 500, ruleStillFires: false })).toBe('could_not_verify');
  });
});
```

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement**

```typescript
export type RescanResolution = 'fixed' | 'excluded' | 'could_not_verify';

export function resolveFindingOutcome(input: {
  ruleStillFires: boolean;
  httpStatus: number | null;
  blockedByRobots: boolean;
  noindex: boolean;
}): RescanResolution | null {
  if (input.blockedByRobots || input.noindex) return 'excluded';
  if (input.httpStatus === null || input.httpStatus >= 400) return 'could_not_verify';
  if (!input.ruleStillFires) return 'fixed';
  return null;
}
```

- [ ] **Step 4: Run, confirm passes.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/verified-on-rescan.ts src/lib/verified-on-rescan.test.ts
git commit -m "feat(verified-on-rescan): add pure outcome decision function"
```

---

### Task 4: DB-touching resolver + audit log

**Files:**
- Modify: `src/lib/verified-on-rescan.ts`
- Create: `src/lib/verified-on-rescan.db.test.ts` (mocked `db`, matching the mocking style in `src/lib/run-scan.test.ts`)

**Interfaces:**
- Consumes: `normalizePageUrlForRescan`, `resolveFindingOutcome` (Tasks 2-3); `db` from `@/lib/db`.
- Produces:
  - `resolvePriorFindingsForPage(params: { websiteId: string; customerId: string; scanJobId: string; pageUrl: string; agent: string; firedRuleIds: Set<string>; httpStatus: number | null; blockedByRobots: boolean; noindex: boolean; evidenceForFixed: (ruleId: string) => unknown }): Promise<{ resolvedCount: number }>` -- called once per crawled page from Task 5.
  - `resolveUnvisitedFindings(params: { websiteId: string; scanJobId: string; visitedNormalizedPageUrls: Set<string> }): Promise<{ resolvedCount: number }>` -- called once at end of scan from Task 5.

- [ ] **Step 1: Write the failing tests** (mock `@/lib/db` the way `run-scan.test.ts` does -- stub `finding.findMany`, `finding.update`, `auditLogEntry.create`)

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    finding: { findMany: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn() },
  },
}));
import { db } from '@/lib/db';
import { resolvePriorFindingsForPage, resolveUnvisitedFindings } from './verified-on-rescan';

describe('resolvePriorFindingsForPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks a prior open finding fixed and writes one audit entry when the rule no longer fires', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} },
    ]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({ canonical: 'https://example.com/blog' }),
    });
    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'f1' },
      data: expect.objectContaining({ resolution: 'fixed', resolvedByScanJobId: 'scan2' }),
    }));
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(1);
    expect(db.auditLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'finding_resolved_on_rescan', customerId: 'c1' }),
    }));
  });

  it('does not touch a finding whose rule still fires (still found, no write)', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} },
    ]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(['missing_canonical']), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(db.finding.update).not.toHaveBeenCalled();
    expect(db.auditLogEntry.create).not.toHaveBeenCalled();
  });

  it('marks could_not_verify without setting resolvedAt and without an audit entry', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} },
    ]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(), httpStatus: 503, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { resolution: 'could_not_verify' },
    }));
    expect(db.auditLogEntry.create).not.toHaveBeenCalled();
  });

  it('only queries findings not already terminally resolved (fixed/excluded excluded from the query)', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(db.finding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ resolution: { in: [null, 'could_not_verify'] } }),
    }));
  });

  it('is idempotent: calling twice does not write a second audit entry for the same finding, because the first call already excluded it from the open-findings query', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} }])
      .mockResolvedValueOnce([]);
    const args = {
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set<string>(), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    };
    await resolvePriorFindingsForPage(args);
    await resolvePriorFindingsForPage(args);
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-fixed finding alone when the same rule fires again later (came back) -- the where-clause excludes fixed/excluded from the query, so it never reaches the update branch', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan3', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(['missing_canonical']), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(result.resolvedCount).toBe(0);
    expect(db.finding.update).not.toHaveBeenCalled();
  });
});

describe('resolveUnvisitedFindings', () => {
  it('marks could_not_verify for open findings on pages the scan never visited this run', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f2', pageUrl: 'https://example.com/unreached' },
    ]);
    await resolveUnvisitedFindings({ websiteId: 'w1', scanJobId: 'scan2', visitedNormalizedPageUrls: new Set(['https://example.com/blog']) });
    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'f2' },
      data: { resolution: 'could_not_verify' },
    }));
  });
});
```

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement** (append to `src/lib/verified-on-rescan.ts`)

```typescript
import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export async function resolvePriorFindingsForPage(params: {
  websiteId: string;
  customerId: string;
  scanJobId: string;
  pageUrl: string;
  agent: string;
  firedRuleIds: Set<string>;
  httpStatus: number | null;
  blockedByRobots: boolean;
  noindex: boolean;
  evidenceForFixed: (ruleId: string) => unknown;
}): Promise<{ resolvedCount: number }> {
  const normalized = normalizePageUrlForRescan(params.pageUrl);
  const priorFindings = await db.finding.findMany({
    where: {
      websiteId: params.websiteId,
      agent: params.agent,
      resolution: { in: [null, 'could_not_verify'] },
      scanJobId: { not: params.scanJobId },
    },
  });
  const onThisPage = priorFindings.filter((f) => normalizePageUrlForRescan(f.pageUrl) === normalized);

  let resolvedCount = 0;
  for (const finding of onThisPage) {
    const outcome = resolveFindingOutcome({
      ruleStillFires: params.firedRuleIds.has(finding.ruleId),
      httpStatus: params.httpStatus,
      blockedByRobots: params.blockedByRobots,
      noindex: params.noindex,
    });
    if (outcome === null) continue; // still found, nothing to write

    if (outcome === 'could_not_verify') {
      await db.finding.update({ where: { id: finding.id }, data: { resolution: 'could_not_verify' } });
      continue;
    }

    await db.finding.update({
      where: { id: finding.id },
      data: {
        resolution: outcome,
        resolvedAt: new Date(),
        resolvedByScanJobId: params.scanJobId,
        evidence: outcome === 'fixed' ? (params.evidenceForFixed(finding.ruleId) as Prisma.InputJsonValue) : finding.evidence,
      },
    });
    await db.auditLogEntry.create({
      data: {
        customerId: params.customerId,
        eventType: 'finding_resolved_on_rescan',
        detail: { findingId: finding.id, resolution: outcome, scanJobId: params.scanJobId },
      },
    });
    resolvedCount += 1;
  }
  return { resolvedCount };
}

export async function resolveUnvisitedFindings(params: {
  websiteId: string;
  scanJobId: string;
  visitedNormalizedPageUrls: Set<string>;
}): Promise<{ resolvedCount: number }> {
  const openFindings = await db.finding.findMany({
    where: { websiteId: params.websiteId, resolution: { in: [null, 'could_not_verify'] }, scanJobId: { not: params.scanJobId } },
  });
  let resolvedCount = 0;
  for (const finding of openFindings) {
    if (params.visitedNormalizedPageUrls.has(normalizePageUrlForRescan(finding.pageUrl))) continue;
    await db.finding.update({ where: { id: finding.id }, data: { resolution: 'could_not_verify' } });
    resolvedCount += 1;
  }
  return { resolvedCount };
}
```

- [ ] **Step 4: Run, confirm passes.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/verified-on-rescan.ts src/lib/verified-on-rescan.db.test.ts
git commit -m "feat(verified-on-rescan): add DB resolver + audit logging, idempotent"
```

---

### Task 5: Wire into the scan pipeline

**Files:**
- Modify: `src/lib/run-scan.ts` (per-page loop around lines 268-360, end of `performance` loop)
- Modify: `src/lib/run-scan.test.ts`

**Interfaces:**
- Consumes: `resolvePriorFindingsForPage`, `resolveUnvisitedFindings`, `normalizePageUrlForRescan` (Task 4).

**Addendum -- crawler-level page-identity dedupe (overseer gap, not in the original task):** `normalizePageUrlForRescan` as used by the resolver only cleans up matching for findings already in the DB. It does not stop the crawler from visiting and storing the bare domain and `/` as two separate pages in the first place (live bug on Yoki: two meta-description drafts for one page). Fix this at the actual page-enumeration choke point -- in `run-scan.ts`, right after `performance = performance.filter((page) => !isAuthOrAccountPath(page.url));` (the one place both the GSC-backed and non-GSC discovery paths converge, before the per-page loop), deduplicate `performance` by `normalizePageUrlForRescan(page.url)`, keeping the first occurrence. Add a regression test: two discovered URLs that normalize to the same identity (e.g. `https://example.com` and `https://example.com/` via an internal link) must result in only one page actually being scanned.

- [ ] **Step 1: Write the failing integration test** in `run-scan.test.ts` -- mock `db.finding.findMany` to return one prior open finding for a page whose new-scan status is 200 and whose rule set no longer includes that `ruleId`; assert `db.finding.update` was called with `resolution: 'fixed'`. Follow the existing per-model `vi.mock('@/lib/db', ...)` stub style already in that file.

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement** -- in the per-page loop (`src/lib/run-scan.ts:268-360`):

```typescript
import { resolvePriorFindingsForPage, resolveUnvisitedFindings, normalizePageUrlForRescan } from '@/lib/verified-on-rescan';
```

Change line 278's destructure from `const { html, status } = await fetchHtmlWithStatus(page.url);` to `const { html, status, blockedByRobots } = await fetchHtmlWithStatus(page.url);`.

Before the `for (const page of performance)` loop, declare `const visitedNormalizedPageUrls = new Set<string>();`. As the first statement inside the loop body (right after the cancellation check, before `logStep`), add `visitedNormalizedPageUrls.add(normalizePageUrlForRescan(page.url));` so a page counts as visited even if it 400s or is noindexed.

Add a `resolvePriorFindingsForPage` call at each of the three points the loop can finish handling a page, each with the `firedRuleIds` appropriate to what was actually evaluated:
1. After the `status >= 400` branch (around line 300), before `continue`: `firedRuleIds: new Set()`, `noindex: false` (noindex was never checked).
2. After the `hasNoindexMeta(html)` branch (around line 309), before its `continue`: `firedRuleIds: new Set()`, `noindex: true`.
3. After `createdSeoFindings` is computed (around line 360): `firedRuleIds: new Set(createdSeoFindings.map((f) => f.ruleId))`, `noindex: false`.

All three pass `websiteId: website.id`, `customerId: customer.id`, `scanJobId: scanJobId ?? ''` (guard the call with `if (scanJobId)` and skip entirely when there is no job id, matching the existing `scanJobId ?? null` pattern used elsewhere in this file for Finding creation), `pageUrl: page.url`, `agent: 'seo_specialist'`, `httpStatus: status`, `blockedByRobots`, and `evidenceForFixed: (ruleId) => ({ note: 'rule no longer fires', checkedAt: new Date().toISOString() })` (a minimal honest evidence payload -- refine per-rule if a richer positive-evidence shape is easy to pull from `seoSignals` for that `ruleId`, but do not block this task on building a full per-rule evidence catalog).

After the `for (const page of performance)` loop ends, call:

```typescript
if (scanJobId) {
  await resolveUnvisitedFindings({ websiteId: website.id, scanJobId, visitedNormalizedPageUrls });
}
```

- [ ] **Step 4: Run, confirm passes** -- `npx vitest run src/lib/run-scan.test.ts`, all prior tests still green plus the new one.

- [ ] **Step 5: Commit**

```bash
git add src/lib/run-scan.ts src/lib/run-scan.test.ts
git commit -m "feat(run-scan): resolve prior findings against each new scan (verified-on-rescan)"
```

---

### Task 6: Review queue stops showing resolved actions

**Files:**
- Modify: `src/app/review/page.tsx` (around the `pendingActions` query, lines 42-43)
- Test: `src/app/review/page.test.tsx` (create if no test file exists yet for this page; otherwise extend it)

**Interfaces:**
- Consumes: `Action.provenanceRecords[].findings[].finding.resolution` (Prisma relations already defined: `Action.provenanceRecords: ActionProvenance[]`, `ActionProvenance.findings: ActionProvenanceFinding[]`, `ActionProvenanceFinding.finding: Finding`).

- [ ] **Step 1: Write the failing test** -- construct a pending `Action` whose every `ActionProvenanceFinding.finding.resolution` is `'fixed'` or `'excluded'`; assert it is excluded from the page's rendered list. Construct a second pending action with at least one unresolved causal finding; assert it still renders. Construct a third pending action with zero causal findings (no provenance records); assert it still renders (unaffected by this feature).

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement** -- in the `pendingActions` query (`src/app/review/page.tsx:42-43`), include the provenance chain and filter in application code (Prisma can't express "every related row satisfies X" in a single `where` without a raw query):

```typescript
const pendingActions = await db.action.findMany({
  where: { customerId, status: 'pending' },
  include: { provenanceRecords: { include: { findings: { include: { finding: true } } } } },
  orderBy: { createdAt: 'desc' },
});
const visiblePendingActions = pendingActions.filter((action) => {
  const causalFindings = action.provenanceRecords.flatMap((pr) => pr.findings.map((f) => f.finding));
  if (causalFindings.length === 0) return true; // no causal findings recorded -- unaffected by this feature
  return !causalFindings.every((f) => f.resolution === 'fixed' || f.resolution === 'excluded');
});
```

Use `visiblePendingActions` everywhere `pendingActions` was used downstream (the `activeType` filter at line 50 and the render).

- [ ] **Step 4: Run, confirm passes.**

- [ ] **Step 5: Commit**

```bash
git add src/app/review/page.tsx src/app/review/page.test.tsx
git commit -m "fix(review): hide pending actions whose causal findings were all resolved on rescan"
```

---

### Task 7: Outcomes "Verified fixes" block

**Files:**
- Create: `src/components/dashboard/verified-fixes-block.tsx`
- Create: `src/components/dashboard/verified-fixes-block.test.tsx`
- Modify: `src/components/dashboard/outcomes-summary.tsx` (insert the new block above the existing GSC evidence table, per spec)
- Modify wherever `outcomes-summary.tsx`'s data is fetched (the Outcomes-tab section of `src/app/dashboard/[websiteId]/page.tsx`) to also query resolved findings for this website.

**Interfaces:**
- Consumes: a server-fetched prop shaped as:
```typescript
interface VerifiedFixesData {
  last30: { count: number; medianDaysToVerify: number | null };
  last90: { count: number; medianDaysToVerify: number | null };
  byRule: Array<{ ruleId: string; rows: Array<{ pageUrl: string; firstFoundAt: string; resolvedAt: string; resolution: 'fixed' | 'excluded'; proofLine: string }>; rejectedAsFalsePositiveRate: number | null }>;
}
```
- Produces: `<VerifiedFixesBlock data={data} loading={loading} />` where `data: VerifiedFixesData | null` -- `null` (and not loading) renders the empty state.

- [ ] **Step 1: Write the failing tests** for `verified-fixes-block.tsx` covering empty (`data: null`, `loading: false` -> "No verified fixes yet" copy, no table), loading (`loading: true` -> skeleton, no empty-state copy), and filled (counts + grouped rows + proof line render; a `could_not_verify` or still-open finding never appears because it was never included in `data` in the first place -- the component trusts its input, the query in Step 3 is what excludes them).

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement the component and its query** -- follow the existing card/list structure in `outcomes-summary.tsx` and `marketing-memory-panel.tsx` (role="region" aria-label, `<ul>`/`<li>` list, `min-h-11` on any interactive control, break-words on page URLs). Add the query as a new exported function in `src/lib/outcomes.ts` if that file exists (check first; otherwise co-locate in `verified-on-rescan.ts` as `getVerifiedFixesForWebsite(websiteId: string): Promise<VerifiedFixesData>`), following the existing Outcomes query style used by `src/app/api/cron/measure-outcomes`. Query: `Finding` rows where `websiteId` matches and `resolution IN ('fixed','excluded')`; `last30`/`last90` filter on `resolvedAt >= now() - 30d` / `90d`; median of `(resolvedAt - retrievedAt)` in days computed in application code (sort the day-diffs, pick the middle); group by `ruleId` for `byRule`. `rejectedAsFalsePositiveRate` per rule: among `Action` rows whose causal `ActionProvenanceFinding.finding.ruleId` equals this rule, the share with `status: 'rejected'` (null if there are zero such actions, not zero -- division by zero is not "0% rejected").

- [ ] **Step 4: Run, confirm passes.**

- [ ] **Step 5: Wire into the dashboard page and `outcomes-summary.tsx`, above the GSC evidence table** (per spec line 25-29). Render this block unconditionally, regardless of GSC connection state, per spec's "works without GSC" requirement -- do not gate it behind the same `gscConnected` check that gates the GSC evidence table below it.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/verified-fixes-block.tsx src/components/dashboard/verified-fixes-block.test.tsx src/components/dashboard/outcomes-summary.tsx
git commit -m "feat(outcomes): add Verified fixes block (works without GSC)"
```

- [ ] **Step 7: Flag for overseer** -- needs overseer screenshots: `/dashboard/[websiteId]` (Outcomes tab) at 320px, 768px, 1280px, both empty-state and filled-state if a test site with resolved findings is available.

---

### Task 8: Weekly automatic rescan (overseer gap, added to this plan)

**Why:** without a scheduled trigger, a finding only ever gets verified if a human presses "Run audit." A weekly cron keeps every website's open findings checked automatically.

**Files:**
- Create: `src/app/api/cron/weekly-rescan/route.ts`
- Create: `src/app/api/cron/weekly-rescan/route.test.ts`
- Modify: `vercel.json` (add a `crons` entry)

**Interfaces:**
- Consumes: `enqueueScanIfNeeded(customerId, website)` from `src/lib/scan-trigger.ts` (already shared by `/api/scan` and the command bar's `run_audit` intent) -- no new scan-triggering mechanism.

- [ ] **Step 1: Write the failing test** -- follow `src/app/api/cron/competitor-watch/route.test.ts`'s exact pattern (bearer-secret auth checks, enumerate-and-process-with-per-item-try/catch). Assert: 401 with no/wrong/unset `CRON_SECRET`; queries only websites with a confirmed URL (`url: { not: PENDING_WEBSITE_URL }`); calls `enqueueScanIfNeeded` per website; counts `enqueued` vs `alreadyQueued` vs `failed` without one failure stopping the rest.
- [ ] **Step 2: Run, confirm fails.**
- [ ] **Step 3: Implement** the route (same bearer-auth shape as `measure-outcomes`/`competitor-watch`), looping websites and calling `enqueueScanIfNeeded`. Note: `Website` has no direct `customerId` -- select `clientProfile: { select: { customerId: true } }` and pass `website.clientProfile.customerId`.
- [ ] **Step 4: Run, confirm passes.**
- [ ] **Step 5: Add the cron entry** to `vercel.json`'s existing `crons` array: `{ "path": "/api/cron/weekly-rescan", "schedule": "0 5 * * 1" }` (Monday, ahead of `competitor-watch`'s Monday 6am).
- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/weekly-rescan vercel.json
git commit -m "feat(cron): add weekly automatic rescan per website"
```

---

## Final verification

- [ ] `npx vitest run` -- full suite green (note: a typecheck step may still be blocked by the pre-existing generated-Prisma-types DB-freeze issue Pam flagged; confirm that blocker predates this feature's own files before treating it as expected, not a regression this plan introduced).
- [ ] `npx eslint src/lib/verified-on-rescan.ts src/lib/run-scan.ts src/app/review/page.tsx src/components/dashboard/verified-fixes-block.tsx src/components/dashboard/outcomes-summary.tsx` -- 0 new errors.
- [ ] Re-read the Acceptance section of the spec line by line against the tests actually written; confirm every bullet has a named test.
