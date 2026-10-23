# Phase 8A — Feedback-Analysis Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard's Analytics tab a real read surface over the approve/reject/edit history Dex already records, plus an on-demand, cached, provenance-aware AI summary of recurring edit patterns — with no preference inference or auto-promotion.

**Architecture:** A new pure-function library (`src/lib/feedback-analysis.ts`) computes live decision counts from data the dashboard page already fetches, and separately builds/calls an LLM summary over a bounded, minimized slice of recent edits. A new `FeedbackAnalysis` table caches only the expensive LLM output, keyed by a fingerprint of its source `AuditLogEntry` IDs so staleness is detectable without re-running the model. A new API route triggers generation on demand; the Analytics tab renders both halves.

**Tech Stack:** Next.js 14 App Router, Prisma, Vitest, the existing `openai` SDK client pattern (`MODEL = 'openai/gpt-oss-120b'`), React server components.

## Global Constraints

- No preference is inferred, stored as a rule, or auto-applied to future generation — this phase is read-only analysis. (spec: "What this is, precisely")
- The LLM summary prompt carries only `actionType`, `decision`, `timestamp`, and the before/after text pair per edit — no `ClientProfile` brand data, no customer identity. (spec: "Architecture")
- `MIN_EDITS_FOR_SUMMARY = 5`; below this, skip the LLM call entirely — no fabricated pattern from noise. (spec: "Architecture")
- `MAX_EDITS_FOR_SUMMARY = 30`; only the 30 most recent eligible edits (by `createdAt`) are ever sent to the model or counted in provenance. (spec: "Architecture")
- Counts (`computeDecisionBreakdown`) are never cached — recomputed fresh on every page load. Only `summary` is cached. (spec: "Persistence")
- Cross-tenant isolation: a website ID belonging to a different customer must 404, not leak history — same `resolveWebsiteForRequest` chokepoint every other per-site route uses. (spec: "Testing")
- Every task must leave `npx vitest run`, `npx tsc --noEmit`, and `npx next build` green before its commit.

---

### Task 1: `FeedbackAnalysis` schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (add `FeedbackAnalysis` model, add its back-relation to `Website`)
- Create: `prisma/migrations/<timestamp>_add_feedback_analysis/migration.sql` (via `prisma migrate dev`)

**Interfaces:**
- Produces: `FeedbackAnalysis` Prisma model, queryable as `db.feedbackAnalysis.findUnique({ where: { websiteId } })` / `db.feedbackAnalysis.upsert(...)`.

- [ ] **Step 1: Add the model to the schema**

In `prisma/schema.prisma`, add this new model (placed after the existing `Website` model, matching the file's existing model-adjacency convention):

```prisma
model FeedbackAnalysis {
  id                  String    @id @default(cuid())
  websiteId           String    @unique
  website             Website   @relation(fields: [websiteId], references: [id])
  summary             String?
  sourceEditCount     Int
  sourceLatestEntryAt DateTime?
  sourceFingerprint   String?
  modelVersion        String?
  promptVersion       String?
  generatedAt         DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}
```

Then add the back-relation field to the existing `Website` model — find this block:

```prisma
  actions            Action[]
  scanJobs           ScanJob[]
  pageSnapshots      PageSnapshot[]
  findings           Finding[]
  pageLinks          PageLink[]
```

and add `feedbackAnalysis   FeedbackAnalysis?` as a new line in that group.

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_feedback_analysis`
Expected: creates `prisma/migrations/<timestamp>_add_feedback_analysis/migration.sql` containing a single `CREATE TABLE "FeedbackAnalysis"` (with its unique index on `websiteId` and FK to `Website`), applies cleanly against your local dev database, and regenerates the Prisma client with no errors.

- [ ] **Step 3: Verify the client compiles**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `@prisma/client`'s generated types now include `FeedbackAnalysis`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add FeedbackAnalysis model for Phase 8A"
```

---

### Task 2: `computeDecisionBreakdown` — live counts, no caching

**Files:**
- Create: `src/lib/feedback-analysis.ts`
- Test: `src/lib/feedback-analysis.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (first library function).
- Produces: `export interface DecisionBreakdown { totals: { approved: number; rejected: number; edited: number }; byActionType: CategoryCount[] }`, `export function computeDecisionBreakdown(actions: { actionType: string; status: string }[]): DecisionBreakdown`. `CategoryCount` is imported from `@/lib/dashboard-stats` (existing type, `{ category: string; count: number }` — do not redefine it).
- Downstream: Task 6 passes the dashboard page's already-fetched `actions` array (which already has `actionType`/`status` selected) straight into this function — no new DB query for this half.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/feedback-analysis.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeDecisionBreakdown } from './feedback-analysis';

describe('computeDecisionBreakdown', () => {
  it('counts approved/rejected/edited totals, ignoring pending and other statuses', () => {
    const result = computeDecisionBreakdown([
      { actionType: 'meta_description', status: 'approved' },
      { actionType: 'meta_description', status: 'approved' },
      { actionType: 'meta_description', status: 'rejected' },
      { actionType: 'meta_description', status: 'edited' },
      { actionType: 'meta_description', status: 'pending' },
    ]);

    expect(result.totals).toEqual({ approved: 2, rejected: 1, edited: 1 });
  });

  it('breaks decided actions down by actionType, largest first', () => {
    const result = computeDecisionBreakdown([
      { actionType: 'meta_description', status: 'approved' },
      { actionType: 'meta_description', status: 'edited' },
      { actionType: 'title_tag', status: 'approved' },
      { actionType: 'title_tag', status: 'approved' },
      { actionType: 'title_tag', status: 'approved' },
    ]);

    expect(result.byActionType).toEqual([
      { category: 'title_tag', count: 3 },
      { category: 'meta_description', count: 2 },
    ]);
  });

  it('excludes pending actions from the actionType breakdown too', () => {
    const result = computeDecisionBreakdown([
      { actionType: 'meta_description', status: 'pending' },
      { actionType: 'title_tag', status: 'approved' },
    ]);

    expect(result.byActionType).toEqual([{ category: 'title_tag', count: 1 }]);
  });

  it('returns real zeros for an empty input, not a fabricated placeholder', () => {
    const result = computeDecisionBreakdown([]);

    expect(result).toEqual({ totals: { approved: 0, rejected: 0, edited: 0 }, byActionType: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/feedback-analysis.test.ts`
Expected: FAIL — `Cannot find module './feedback-analysis'` (file doesn't exist yet).

- [ ] **Step 3: Implement `computeDecisionBreakdown`**

Create `src/lib/feedback-analysis.ts`:

```typescript
import type { CategoryCount } from './dashboard-stats';

export interface DecisionBreakdown {
  totals: { approved: number; rejected: number; edited: number };
  byActionType: CategoryCount[];
}

const DECIDED_STATUSES = new Set(['approved', 'rejected', 'edited']);

// Real counts only — recomputed fresh on every page load, never cached. Pending/failed
// actions are excluded from both the totals and the breakdown; they haven't been decided yet.
export function computeDecisionBreakdown(actions: { actionType: string; status: string }[]): DecisionBreakdown {
  const decided = actions.filter((a) => DECIDED_STATUSES.has(a.status));

  const totals = { approved: 0, rejected: 0, edited: 0 };
  const byActionTypeCounts = new Map<string, number>();
  for (const action of decided) {
    if (action.status === 'approved') totals.approved += 1;
    else if (action.status === 'rejected') totals.rejected += 1;
    else if (action.status === 'edited') totals.edited += 1;
    byActionTypeCounts.set(action.actionType, (byActionTypeCounts.get(action.actionType) ?? 0) + 1);
  }

  const byActionType = Array.from(byActionTypeCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return { totals, byActionType };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/feedback-analysis.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/feedback-analysis.ts src/lib/feedback-analysis.test.ts
git commit -m "feat: add computeDecisionBreakdown for Phase 8A live counts"
```

---

### Task 3: eligible-edit extraction, fingerprinting, and the LLM summary

**Files:**
- Modify: `src/lib/feedback-analysis.ts`
- Modify: `src/lib/feedback-analysis.test.ts`

**Interfaces:**
- Consumes: `DecisionBreakdown`/`computeDecisionBreakdown` from Task 2 (same file, untouched).
- Produces:
  - `export const MIN_EDITS_FOR_SUMMARY = 5`
  - `export const MAX_EDITS_FOR_SUMMARY = 30`
  - `export const PROMPT_VERSION = 'v1'`
  - `export const SUMMARY_MODEL = 'openai/gpt-oss-120b'`
  - `export interface EligibleEdit { auditLogEntryId: string; actionType: string; before: string; after: string; timestamp: Date }`
  - `export function extractEligibleEdits(auditEntries: { id: string; actionId: string | null; detail: unknown; createdAt: Date }[], actionsById: Map<string, { actionType: string; draftContent: string }>): EligibleEdit[]` — filters to `eventType`-already-filtered `action_decided` entries whose `detail.decision === 'edited'` and `detail.originalDraftContent` is a non-empty string, joins to the matching action for `actionType`/current `draftContent`, sorts newest-first by `createdAt`, and caps at `MAX_EDITS_FOR_SUMMARY`.
  - `export function computeSourceFingerprint(edits: EligibleEdit[]): string` — sha256 hex digest of the sorted `auditLogEntryId` list, joined by `,`.
  - `export function buildFeedbackSummaryPrompt(edits: EligibleEdit[]): string`
  - `type SummaryCaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>`
  - `export async function generateFeedbackSummary(edits: EligibleEdit[], callOpenAI?: SummaryCaller): Promise<string>` — honest fallback string on empty/error response, never throws. Caller does NOT enforce `MIN_EDITS_FOR_SUMMARY` itself (that's the API route's job in Task 4) — this function assumes it's only called with an already-eligible edit list.
- Downstream: Task 4's API route calls `extractEligibleEdits`, `computeSourceFingerprint`, and `generateFeedbackSummary` in sequence.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/feedback-analysis.test.ts`:

```typescript
import {
  computeDecisionBreakdown,
  extractEligibleEdits,
  computeSourceFingerprint,
  buildFeedbackSummaryPrompt,
  generateFeedbackSummary,
  MAX_EDITS_FOR_SUMMARY,
} from './feedback-analysis';
```

(replace the existing single-line import at the top of the file with this multi-line one), then add:

```typescript
describe('extractEligibleEdits', () => {
  const actionsById = new Map([
    ['a1', { actionType: 'meta_description', draftContent: 'New meta text.' }],
    ['a2', { actionType: 'title_tag', draftContent: 'New title.' }],
  ]);

  it('keeps only action_decided edited entries with a real originalDraftContent', () => {
    const result = extractEligibleEdits(
      [
        { id: 'e1', actionId: 'a1', detail: { decision: 'edited', originalDraftContent: 'Old meta text.' }, createdAt: new Date('2026-09-01') },
        { id: 'e2', actionId: 'a2', detail: { decision: 'approved' }, createdAt: new Date('2026-09-02') },
        { id: 'e3', actionId: 'a1', detail: { decision: 'edited', originalDraftContent: '' }, createdAt: new Date('2026-09-03') },
      ],
      actionsById
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      auditLogEntryId: 'e1',
      actionType: 'meta_description',
      before: 'Old meta text.',
      after: 'New meta text.',
    });
  });

  it('sorts newest-first and caps at MAX_EDITS_FOR_SUMMARY', () => {
    const entries = Array.from({ length: MAX_EDITS_FOR_SUMMARY + 10 }, (_, i) => ({
      id: `e${i}`,
      actionId: 'a1',
      detail: { decision: 'edited', originalDraftContent: 'Old.' },
      createdAt: new Date(2026, 0, i + 1),
    }));

    const result = extractEligibleEdits(entries, actionsById);

    expect(result).toHaveLength(MAX_EDITS_FOR_SUMMARY);
    expect(result[0].auditLogEntryId).toBe(`e${MAX_EDITS_FOR_SUMMARY + 9}`);
  });

  it('skips an entry whose actionId has no matching action', () => {
    const result = extractEligibleEdits(
      [{ id: 'e1', actionId: 'missing', detail: { decision: 'edited', originalDraftContent: 'Old.' }, createdAt: new Date() }],
      actionsById
    );

    expect(result).toEqual([]);
  });
});

describe('computeSourceFingerprint', () => {
  it('is order-independent and deterministic', () => {
    const editA = { auditLogEntryId: 'e2', actionType: 'x', before: 'a', after: 'b', timestamp: new Date() };
    const editB = { auditLogEntryId: 'e1', actionType: 'x', before: 'a', after: 'b', timestamp: new Date() };

    expect(computeSourceFingerprint([editA, editB])).toBe(computeSourceFingerprint([editB, editA]));
  });

  it('changes when the edit set changes', () => {
    const edits = [{ auditLogEntryId: 'e1', actionType: 'x', before: 'a', after: 'b', timestamp: new Date() }];
    const moreEdits = [...edits, { auditLogEntryId: 'e2', actionType: 'x', before: 'c', after: 'd', timestamp: new Date() }];

    expect(computeSourceFingerprint(edits)).not.toBe(computeSourceFingerprint(moreEdits));
  });
});

describe('buildFeedbackSummaryPrompt', () => {
  it('includes only actionType, decision, timestamp, and the before/after text — no brand or customer data', () => {
    const prompt = buildFeedbackSummaryPrompt([
      { auditLogEntryId: 'e1', actionType: 'meta_description', before: 'Old text.', after: 'New text.', timestamp: new Date('2026-09-01T00:00:00Z') },
    ]);

    expect(prompt).toContain('meta_description');
    expect(prompt).toContain('Old text.');
    expect(prompt).toContain('New text.');
    expect(prompt).toContain('2026-09-01');
    expect(prompt.toLowerCase()).toContain('never invent');
  });
});

describe('generateFeedbackSummary', () => {
  const edits = [{ auditLogEntryId: 'e1', actionType: 'meta_description', before: 'Old.', after: 'New, shorter.', timestamp: new Date() }];

  it('returns the OpenAI-generated summary on success', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'Edits tend to shorten meta descriptions.', totalTokens: 50 });

    const result = await generateFeedbackSummary(edits, callOpenAI);

    expect(result).toBe('Edits tend to shorten meta descriptions.');
  });

  it('falls back to an honest message when OpenAI fails', async () => {
    const callOpenAI = vi.fn().mockRejectedValue(new Error('rate limited'));

    const result = await generateFeedbackSummary(edits, callOpenAI);

    expect(result).toContain("couldn't");
  });

  it('falls back when OpenAI returns an empty response', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '', totalTokens: 0 });

    const result = await generateFeedbackSummary(edits, callOpenAI);

    expect(result).toContain("couldn't");
  });
});
```

Add `vi` to the existing `import { describe, it, expect } from 'vitest';` line (change it to `import { describe, it, expect, vi } from 'vitest';`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/feedback-analysis.test.ts`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Implement the new functions**

Append to `src/lib/feedback-analysis.ts` (add `import { createHash } from 'crypto';` and `import OpenAI from 'openai';` to its top imports alongside the existing `dashboard-stats` import):

```typescript
export const MIN_EDITS_FOR_SUMMARY = 5;
export const MAX_EDITS_FOR_SUMMARY = 30;
export const PROMPT_VERSION = 'v1';
export const SUMMARY_MODEL = 'openai/gpt-oss-120b';

export interface EligibleEdit {
  auditLogEntryId: string;
  actionType: string;
  before: string;
  after: string;
  timestamp: Date;
}

interface AuditDetailShape {
  decision?: string;
  originalDraftContent?: string;
}

// An eligible edit is an action_decided entry whose decision was 'edited' and which
// captured a real originalDraftContent -- the exact shape the edit route
// (src/app/api/actions/[actionId]/edit/route.ts) always writes. Newest first, capped at
// MAX_EDITS_FOR_SUMMARY so a mature account's full history never blows up prompt size/cost.
export function extractEligibleEdits(
  auditEntries: { id: string; actionId: string | null; detail: unknown; createdAt: Date }[],
  actionsById: Map<string, { actionType: string; draftContent: string }>
): EligibleEdit[] {
  const eligible: EligibleEdit[] = [];
  for (const entry of auditEntries) {
    const detail = entry.detail as AuditDetailShape | null;
    if (!entry.actionId || detail?.decision !== 'edited' || !detail.originalDraftContent) continue;
    const action = actionsById.get(entry.actionId);
    if (!action) continue;
    eligible.push({
      auditLogEntryId: entry.id,
      actionType: action.actionType,
      before: detail.originalDraftContent,
      after: action.draftContent,
      timestamp: entry.createdAt,
    });
  }
  return eligible.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, MAX_EDITS_FOR_SUMMARY);
}

// The staleness signal: a sha256 of the sorted source AuditLogEntry IDs. Any new eligible
// edit (or a different set entering the MAX_EDITS_FOR_SUMMARY window) changes the hash.
export function computeSourceFingerprint(edits: EligibleEdit[]): string {
  const ids = edits.map((e) => e.auditLogEntryId).sort();
  return createHash('sha256').update(ids.join(',')).digest('hex');
}

export function buildFeedbackSummaryPrompt(edits: EligibleEdit[]): string {
  const lines = edits.map(
    (e) =>
      `- Action type: ${e.actionType} | Decision: edited | Timestamp: ${e.timestamp.toISOString()}\n  Before: ${e.before}\n  After: ${e.after}`
  );
  return [
    'You analyze how a website owner edits AI-generated draft changes before approving them.',
    'Rules:',
    '- Base your analysis ONLY on the edits listed below. Never invent facts, patterns, or edits not present in them.',
    "- If you don't see a clear recurring pattern across multiple edits, say so honestly instead of forcing one.",
    '- Two or three short sentences, plain English, no jargon.',
    '- Output ONLY the analysis text. No quotes, no preamble, no explanation.',
    '',
    'Recent edits:',
    ...lines,
  ].join('\n');
}

type SummaryCaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

async function defaultSummaryCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    timeout: 15_000,
    maxRetries: 1,
  });
  const completion = await openai.chat.completions.create({
    model: SUMMARY_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function generateFeedbackSummary(edits: EligibleEdit[], callOpenAI: SummaryCaller = defaultSummaryCaller): Promise<string> {
  try {
    const { content } = await callOpenAI(buildFeedbackSummaryPrompt(edits));
    if (!content) return "Dex couldn't generate a pattern summary this time. Your edit counts above are still accurate.";
    return content;
  } catch {
    return "Dex couldn't generate a pattern summary this time. Your edit counts above are still accurate.";
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/feedback-analysis.test.ts`
Expected: PASS, all tests (4 from Task 2 + the new ones).

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/feedback-analysis.ts src/lib/feedback-analysis.test.ts
git commit -m "feat: add eligible-edit extraction, fingerprinting, and AI summary generation"
```

---

### Task 4: API route — `POST /api/websites/[id]/feedback-analysis`

**Files:**
- Create: `src/app/api/websites/[id]/feedback-analysis/route.ts`
- Test: `src/app/api/websites/[id]/feedback-analysis/route.test.ts`

**Interfaces:**
- Consumes: `extractEligibleEdits`, `computeSourceFingerprint`, `generateFeedbackSummary`, `MIN_EDITS_FOR_SUMMARY`, `PROMPT_VERSION`, `SUMMARY_MODEL` from `@/lib/feedback-analysis` (Tasks 2-3); `resolveWebsiteForRequest`, `WebsiteNotFoundError` from `@/lib/customer` (existing); `db` from `@/lib/db` (existing).
- Produces: the route handler itself. Response body on success: `{ summary: string | null, sourceEditCount: number, generatedAt: string, belowThreshold: boolean, needed: number }`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/websites/[id]/feedback-analysis/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { generateFeedbackSummary } from '@/lib/feedback-analysis';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findMany: vi.fn() },
    auditLogEntry: { findMany: vi.fn() },
    feedbackAnalysis: { upsert: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/feedback-analysis', async () => {
  const actual = await vi.importActual<typeof import('@/lib/feedback-analysis')>('@/lib/feedback-analysis');
  return { ...actual, generateFeedbackSummary: vi.fn() };
});

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/websites/w1/feedback-analysis', { method: 'POST' }) as unknown as NextRequest;
}

function editedAction(id: string, daysAgo: number) {
  return { id, actionType: 'meta_description', status: 'edited', draftContent: `New ${id}` };
}

function editedEntry(id: string, actionId: string, daysAgo: number) {
  return {
    id,
    actionId,
    detail: { decision: 'edited', originalDraftContent: `Old ${actionId}` },
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

describe('POST /api/websites/[id]/feedback-analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest(), { params: { id: 'w1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the website does not belong to this customer', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeRequest(), { params: { id: 'someone-elses' } });

    expect(res.status).toBe(404);
    expect(db.action.findMany).not.toHaveBeenCalled();
  });

  it('reports belowThreshold without calling the model when there are fewer than 5 eligible edits', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1' } });
    const actions = [editedAction('a1', 1), editedAction('a2', 2)];
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      editedEntry('e1', 'a1', 1),
      editedEntry('e2', 'a2', 2),
    ]);

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.belowThreshold).toBe(true);
    expect(body.needed).toBe(3);
    expect(generateFeedbackSummary).not.toHaveBeenCalled();
    expect(db.feedbackAnalysis.upsert).not.toHaveBeenCalled();
  });

  it('generates and upserts a summary when at least 5 eligible edits exist', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1' } });
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const actions = ids.map((id, i) => editedAction(id, i));
    const entries = ids.map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (generateFeedbackSummary as ReturnType<typeof vi.fn>).mockResolvedValue('Real pattern summary.');
    (db.feedbackAnalysis.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.belowThreshold).toBe(false);
    expect(body.summary).toBe('Real pattern summary.');
    expect(body.sourceEditCount).toBe(5);
    expect(db.feedbackAnalysis.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = (db.feedbackAnalysis.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ websiteId: 'w1' });
    expect(upsertArgs.create.summary).toBe('Real pattern summary.');
    expect(upsertArgs.create.sourceEditCount).toBe(5);
    expect(upsertArgs.create.modelVersion).toBeTruthy();
    expect(upsertArgs.create.promptVersion).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/websites/\[id\]/feedback-analysis/route.test.ts`
Expected: FAIL — `route.ts` doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/websites/[id]/feedback-analysis/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import {
  extractEligibleEdits,
  computeSourceFingerprint,
  generateFeedbackSummary,
  MIN_EDITS_FOR_SUMMARY,
  PROMPT_VERSION,
  SUMMARY_MODEL,
} from '@/lib/feedback-analysis';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, params.id));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  const editedActions = await db.action.findMany({
    where: { websiteId: website.id, status: 'edited' },
    select: { id: true, actionType: true, draftContent: true },
  });
  const actionsById = new Map(editedActions.map((a) => [a.id, { actionType: a.actionType, draftContent: a.draftContent }]));

  const auditEntries = await db.auditLogEntry.findMany({
    where: { actionId: { in: editedActions.map((a) => a.id) }, eventType: 'action_decided' },
    select: { id: true, actionId: true, detail: true, createdAt: true },
  });

  const eligibleEdits = extractEligibleEdits(auditEntries, actionsById);

  if (eligibleEdits.length < MIN_EDITS_FOR_SUMMARY) {
    return NextResponse.json({
      summary: null,
      sourceEditCount: eligibleEdits.length,
      generatedAt: null,
      belowThreshold: true,
      needed: MIN_EDITS_FOR_SUMMARY - eligibleEdits.length,
    });
  }

  const summary = await generateFeedbackSummary(eligibleEdits);
  const fingerprint = computeSourceFingerprint(eligibleEdits);
  const latestEntryAt = eligibleEdits[0]?.timestamp ?? null;

  const row = await db.feedbackAnalysis.upsert({
    where: { websiteId: website.id },
    create: {
      websiteId: website.id,
      summary,
      sourceEditCount: eligibleEdits.length,
      sourceLatestEntryAt: latestEntryAt,
      sourceFingerprint: fingerprint,
      modelVersion: SUMMARY_MODEL,
      promptVersion: PROMPT_VERSION,
    },
    update: {
      summary,
      sourceEditCount: eligibleEdits.length,
      sourceLatestEntryAt: latestEntryAt,
      sourceFingerprint: fingerprint,
      modelVersion: SUMMARY_MODEL,
      promptVersion: PROMPT_VERSION,
    },
  });

  return NextResponse.json({
    summary: row.summary,
    sourceEditCount: row.sourceEditCount,
    generatedAt: row.generatedAt,
    belowThreshold: false,
    needed: 0,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/websites/\[id\]/feedback-analysis/route.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/websites/\[id\]/feedback-analysis
git commit -m "feat: add POST /api/websites/[id]/feedback-analysis route"
```

---

### Task 5: UI — `FeedbackPatternsCard`

**Files:**
- Create: `src/components/dashboard/feedback-patterns-card.tsx`
- Test: `src/components/dashboard/feedback-patterns-card.test.tsx`

This codebase has no `@testing-library/react` and no jsdom/happy-dom environment (`vitest.config.ts` sets `environment: 'node'`) — confirmed by this session's own `bottom-nav.test.tsx`, which hit "Invalid hook call" trying to call a hooks-using component directly and documents the established fix: **export the component's pure decision logic as standalone functions, test only those; the component itself is verified visually in Task 7, not unit-rendered.** Follow that exact precedent here — do not add `@testing-library/react` as a new dependency.

**Interfaces:**
- Consumes: `DecisionBreakdown` type and `MIN_EDITS_FOR_SUMMARY` from `@/lib/feedback-analysis` (Tasks 2-3). Props:
  ```typescript
  interface FeedbackPatternsCardProps {
    websiteId: string;
    breakdown: DecisionBreakdown;
    cached: { summary: string | null; sourceEditCount: number; generatedAt: Date; isStale: boolean } | null;
    minEditsNeeded: number; // MIN_EDITS_FOR_SUMMARY - live edited count, 0 or negative if eligible
  }
  ```
- Produces:
  - `export function describeEligibility(minEditsNeeded: number): string | null` — pure. Returns `null` when `minEditsNeeded <= 0` (eligible, button enabled); otherwise the honest reason string.
  - `export function formatProvenance(sourceEditCount: number, generatedAt: Date): string` — pure. `"Based on {N} edits, generated {locale date}"`.
  - `export function FeedbackPatternsCard(props: FeedbackPatternsCardProps)` — the actual client component (`'use client'`, uses `useState`), calling the two pure functions above internally. Has an "Analyze my edits" button that `fetch`es `POST /api/websites/${websiteId}/feedback-analysis` and re-renders with the result. Not unit-tested directly — real behavior confirmed via `browse` in Task 7.
- Downstream: Task 6 renders this inside the dashboard page's Analytics tab.

- [ ] **Step 1: Write the failing tests**

Create `src/components/dashboard/feedback-patterns-card.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { describeEligibility, formatProvenance } from './feedback-patterns-card';

describe('describeEligibility', () => {
  it('returns null when the account is eligible (0 needed)', () => {
    expect(describeEligibility(0)).toBeNull();
  });

  it('returns null when minEditsNeeded is negative (comfortably eligible)', () => {
    expect(describeEligibility(-2)).toBeNull();
  });

  it('states the exact shortfall when below threshold', () => {
    expect(describeEligibility(3)).toBe('Need at least 5 edited drafts — you have 2.');
  });

  it('states zero edits honestly when none exist yet', () => {
    expect(describeEligibility(5)).toBe('Need at least 5 edited drafts — you have 0.');
  });
});

describe('formatProvenance', () => {
  it('states the real edit count and a formatted date', () => {
    const result = formatProvenance(6, new Date('2026-09-15T00:00:00Z'));

    expect(result).toContain('6 edits');
    expect(result).toContain('2026');
  });

  it('states a single edit without a fabricated plural mismatch', () => {
    expect(formatProvenance(1, new Date('2026-09-15T00:00:00Z'))).toContain('1 edit');
    expect(formatProvenance(1, new Date('2026-09-15T00:00:00Z'))).not.toContain('1 edits');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/dashboard/feedback-patterns-card.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the component**

Create `src/components/dashboard/feedback-patterns-card.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DecisionBreakdown } from '@/lib/feedback-analysis';
import { MIN_EDITS_FOR_SUMMARY } from '@/lib/feedback-analysis';

export function describeEligibility(minEditsNeeded: number): string | null {
  if (minEditsNeeded <= 0) return null;
  const have = MIN_EDITS_FOR_SUMMARY - minEditsNeeded;
  return `Need at least ${MIN_EDITS_FOR_SUMMARY} edited drafts — you have ${have}.`;
}

export function formatProvenance(sourceEditCount: number, generatedAt: Date): string {
  const editWord = sourceEditCount === 1 ? 'edit' : 'edits';
  return `Based on ${sourceEditCount} ${editWord}, generated ${generatedAt.toLocaleDateString()}`;
}

interface CachedSummary {
  summary: string | null;
  sourceEditCount: number;
  generatedAt: Date;
  isStale: boolean;
}

interface FeedbackPatternsCardProps {
  websiteId: string;
  breakdown: DecisionBreakdown;
  cached: CachedSummary | null;
  minEditsNeeded: number;
}

export function FeedbackPatternsCard({ websiteId, breakdown, cached, minEditsNeeded }: FeedbackPatternsCardProps) {
  const [result, setResult] = useState(cached);
  const [loading, setLoading] = useState(false);
  const [needed, setNeeded] = useState(minEditsNeeded);

  async function handleAnalyze() {
    setLoading(true);
    try {
      const res = await fetch(`/api/websites/${websiteId}/feedback-analysis`, { method: 'POST' });
      const body = await res.json();
      if (body.belowThreshold) {
        setNeeded(body.needed);
        return;
      }
      setResult({
        summary: body.summary,
        sourceEditCount: body.sourceEditCount,
        generatedAt: new Date(body.generatedAt),
        isStale: false,
      });
    } finally {
      setLoading(false);
    }
  }

  const eligibilityMessage = describeEligibility(needed);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-semibold text-foreground">{breakdown.totals.approved}</p>
          <p className="text-xs text-muted-foreground">Approved</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-semibold text-foreground">{breakdown.totals.rejected}</p>
          <p className="text-xs text-muted-foreground">Rejected</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-semibold text-foreground">{breakdown.totals.edited}</p>
          <p className="text-xs text-muted-foreground">Edited</p>
        </div>
      </div>

      {breakdown.byActionType.length > 0 && (
        <p className="text-xs text-muted-foreground">
          By type:{' '}
          {breakdown.byActionType.map((c, i) => (
            <span key={c.category}>
              {i > 0 && ', '}
              {c.category} ({c.count})
            </span>
          ))}
        </p>
      )}

      {result?.summary ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm text-foreground">{result.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatProvenance(result.sourceEditCount, result.generatedAt)}</p>
          {result.isStale && <p className="mt-1 text-xs text-amber-600">New edits since this analysis — refresh?</p>}
          <Button variant="outline" size="sm" className="mt-2" onClick={handleAnalyze} disabled={loading}>
            {loading ? 'Analyzing…' : 'Refresh analysis'}
          </Button>
        </div>
      ) : (
        <div>
          <Button size="sm" onClick={handleAnalyze} disabled={loading || needed > 0}>
            {loading ? 'Analyzing…' : 'Analyze my edits'}
          </Button>
          {eligibilityMessage && <p className="mt-1 text-xs text-muted-foreground">{eligibilityMessage}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/dashboard/feedback-patterns-card.test.tsx`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/feedback-patterns-card.tsx src/components/dashboard/feedback-patterns-card.test.tsx
git commit -m "feat: add FeedbackPatternsCard component"
```

---

### Task 6: Wire into the dashboard's Analytics tab

**Files:**
- Modify: `src/app/dashboard/[websiteId]/page.tsx`

**Interfaces:**
- Consumes: `computeDecisionBreakdown` (Task 2), `computeSourceFingerprint`, `extractEligibleEdits`, `MIN_EDITS_FOR_SUMMARY` (Task 3) from `@/lib/feedback-analysis`; `FeedbackPatternsCard` (Task 5) from `@/components/dashboard/feedback-patterns-card`; the page's own already-fetched `actions` array (has `actionType`/`status`) and `db`/`website` already in scope.
- Produces: nothing new for other tasks — this is the final wiring task.

- [ ] **Step 1: Add the import**

In `src/app/dashboard/[websiteId]/page.tsx`, add these two import lines near the other `@/components/dashboard/*` and `@/lib/*` imports (e.g. right after the `AgentContributionTable` import on line 36, and right after the `computeOpportunityGroups` import on line 27):

```typescript
import { FeedbackPatternsCard } from '@/components/dashboard/feedback-patterns-card';
import { computeDecisionBreakdown, extractEligibleEdits, computeSourceFingerprint, MIN_EDITS_FOR_SUMMARY } from '@/lib/feedback-analysis';
```

- [ ] **Step 2: Compute the breakdown and cached-summary staleness**

Find where `evidenceLedger`/`consolidatedCount` are computed (around what is now line ~233-235, right after `computeOpportunityGroups` is called) and add, in the same block:

```typescript
  const decisionBreakdown = computeDecisionBreakdown(actions);
  const editedActionsById = new Map(
    actions.filter((a) => a.status === 'edited').map((a) => [a.id, { actionType: a.actionType, draftContent: '' }])
  );
```

Note: the page's existing `actions` query (the `db.action.findMany` around line 141) does not currently select `draftContent` — that field is intentionally not needed here, since staleness only needs the *count* of live eligible edits, not their text. Leave the `draftContent: ''` placeholder in `editedActionsById` — it is never read by `computeSourceFingerprint`, only by `extractEligibleEdits`'s `after` field, which this staleness check does not use.

Then, fetch the cached row and the live eligible-edit count/fingerprint for staleness comparison. Add this near the other `Promise.all`-fetched data (or as a standalone `await` right after `actions` is available, since it needs `actions` first):

```typescript
  const cachedFeedbackAnalysis = await db.feedbackAnalysis.findUnique({ where: { websiteId: website.id } });
  let feedbackCached: { summary: string | null; sourceEditCount: number; generatedAt: Date; isStale: boolean } | null = null;
  let feedbackMinEditsNeeded = 0;
  if (cachedFeedbackAnalysis) {
    const liveAuditEntries = await db.auditLogEntry.findMany({
      where: { actionId: { in: Array.from(editedActionsById.keys()) }, eventType: 'action_decided' },
      select: { id: true, actionId: true, detail: true, createdAt: true },
    });
    const liveEligible = extractEligibleEdits(liveAuditEntries, editedActionsById);
    const liveFingerprint = computeSourceFingerprint(liveEligible);
    feedbackCached = {
      summary: cachedFeedbackAnalysis.summary,
      sourceEditCount: cachedFeedbackAnalysis.sourceEditCount,
      generatedAt: cachedFeedbackAnalysis.generatedAt,
      isStale: liveFingerprint !== cachedFeedbackAnalysis.sourceFingerprint,
    };
  } else {
    feedbackMinEditsNeeded = Math.max(0, MIN_EDITS_FOR_SUMMARY - decisionBreakdown.totals.edited);
  }
```

- [ ] **Step 3: Render the card in the Analytics tab**

Find the closing of the Analytics tab's mini-bar-chart grid — the block ending:

```tsx
                <div className="flex flex-col gap-1.5 rounded-lg border border-border p-4">
                  <span className="text-xs font-medium text-muted-foreground">Tokens spent</span>
                  <span className="text-[10px] text-muted-foreground">tokens / day · last {range}d</span>
                  <MiniBarChart data={tokenSeries} dataKey="value" color="var(--dex-app-amber)" label={`Tokens spent per day, last ${range} days`} />
                </div>
              </div>
            </div>
          }
```

and insert a new `Card` right before the final `</div>\n            </div>\n          }` that closes the analytics section:

```tsx
              <Card>
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Feedback patterns</h3>
                    <p className="text-xs text-muted-foreground">Real approve/reject/edit history, and an optional AI summary of recurring edit patterns.</p>
                  </div>
                  <FeedbackPatternsCard
                    websiteId={website.id}
                    breakdown={decisionBreakdown}
                    cached={feedbackCached}
                    minEditsNeeded={feedbackMinEditsNeeded}
                  />
                </CardContent>
              </Card>
```

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new ones from Tasks 2-5.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx next build`
Expected: clean build, `/dashboard/[websiteId]` and the new `/api/websites/[id]/feedback-analysis` route both present in the route table.

- [ ] **Step 6: Commit**

```bash
git add "src/app/dashboard/[websiteId]/page.tsx"
git commit -m "feat: wire Feedback patterns card into the Analytics tab"
```

---

### Task 7: Full regression, browser verification, and deploy

**Files:** none (verification + deployment only)

- [ ] **Step 1: Full verification**

Run in order: `npx vitest run`, `npx tsc --noEmit`, `npx next build`. All must pass. If a local dev server is running on the same port, restart it after the build (this codebase's `next build` corrupts a live dev server's chunk manifest).

- [ ] **Step 2: Visual verification on real data**

Using the project's `browse` skill against an authenticated session: navigate to a real website's dashboard, switch to the Analytics tab, confirm the "Feedback patterns" card renders with real approve/reject/edit counts. If that website has fewer than 5 real edited actions, confirm the honest below-threshold message instead of forcing a fake analysis. If it has 5+, click "Analyze my edits," confirm a real summary renders (or an honest fallback message if the model call fails), and confirm reloading the page still shows the cached summary (not regenerated). Screenshot each state, save to `docs/superpowers/evidence/2026-09-17-responsive-release-gate/after/feedback-patterns/` following this project's existing naming convention.

- [ ] **Step 3: Independent review**

Dispatch a fresh subagent (no shared context with the implementation) as an independent reviewer, checking specifically: does the LLM prompt ever include anything beyond `actionType`/`decision`/`timestamp`/before-after text (grep `buildFeedbackSummaryPrompt`'s actual usage, don't just read the function in isolation)? Does the API route's cross-tenant scoping actually prevent a foreign website ID from returning another customer's edit data (trace `resolveWebsiteForRequest`'s real behavior, don't assume)? Does anything auto-write to `ClientProfile` or any other preference-holding model as a side effect of this feature (grep for writes)? Report findings; fix anything real before deploying.

- [ ] **Step 4: Deploy**

```bash
npx prisma migrate deploy
vercel deploy --prod --yes
```

Confirm the alias: `vercel inspect dex-ai-plum.vercel.app` — printed `id` must match the deployment just created.

- [ ] **Step 5: Record completion**

Append a section to `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md` (matching this session's established per-slice entries): what shipped, commit SHAs, deployment id, the accurate completion statement from the design doc (`docs/superpowers/specs/2026-09-19-phase8a-feedback-analysis-foundation-design.md`), and explicit confirmation that no preference is inferred or auto-applied.

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "docs: record Phase 8A feedback-analysis foundation completion"
```

---

## Self-Review Notes

- **Spec coverage:** live counts (Task 2), minimized-evidence AI summary with min/max bounds (Task 3), persistence with fingerprint-based staleness (Task 1, 4, 6), API surface (Task 4), UI with all 4 documented states — absent-eligible, absent-below-threshold, present-fresh, present-stale (Task 5), cross-tenant isolation test (Task 4), deploy + accurate completion statement (Task 7) — all covered.
- **Placeholder scan:** none found. The `draftContent: ''` placeholder in Task 6 Step 2 is explained inline as intentionally unused by the staleness path, not a deferred implementation gap.
- **Type consistency:** `DecisionBreakdown`/`computeDecisionBreakdown` (Task 2) used identically in Task 6. `EligibleEdit`/`extractEligibleEdits`/`computeSourceFingerprint`/`generateFeedbackSummary` (Task 3) signatures match their usage in both Task 4 (API route) and Task 6 (staleness check). `FeedbackPatternsCardProps` (Task 5) matches exactly what Task 6 passes in.
- **Caught and fixed during self-review:** Task 5's first draft assumed `@testing-library/react`/jsdom were available for component rendering tests. Verified against `vitest.config.ts` (`environment: 'node'`, no testing-library dependency) and this session's own `bottom-nav.test.tsx` — neither exists in this codebase. Rewrote Task 5 to extract and test only the component's pure decision logic (`describeEligibility`, `formatProvenance`), matching this project's actual established precedent for hooks-using client components; the rendered component itself is verified visually in Task 7, not unit-tested.
