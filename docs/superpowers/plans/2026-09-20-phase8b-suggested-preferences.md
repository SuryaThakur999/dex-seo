# Phase 8B — Suggested Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dex automatically notices a repeated phrase pattern in a customer's edits and surfaces exactly one contextual "Should Dex evaluate avoiding this?" card in the Review workflow — no dashboard tab, no manual trigger, no effect on active preferences yet.

**Architecture:** A non-blocking post-render check (not a job queue): the Review page computes cheaply whether a check *might* be worth running, a small client component fires one idempotent `POST` after the page is interactive, and that route does the real work (LLM extraction + a deterministic verification gate) only when the live evidence fingerprint has actually changed since the last check. Customer decisions (Evaluate / Reject) go through a second, simple route. Nothing in this slice writes to `ClientProfile`.

**Tech Stack:** Next.js 14 App Router, Prisma, Vitest, the existing `openai` SDK client pattern, React server + client components.

## Global Constraints

- Approving a candidate sets `status: 'approved_for_evaluation'` only — never writes to `ClientProfile.restrictedWording`. Every UI surface that shows this state says explicitly that active preferences are unchanged.
- No internal terms in customer-facing copy. Use exactly: "Suggested preference," "Dex noticed a pattern," "Evaluate this preference," "Not a preference," "Based on N reviewed drafts." Never show model/prompt versions or fingerprints outside an expandable technical-evidence disclosure.
- A candidate is only ever created after it passes all 6 conditions of the deterministic verification gate (spec: "Deterministic verification gate") — the LLM proposes, the gate decides.
- `MIN_EDITS_FOR_SUMMARY = 5` (reused from `@/lib/feedback-analysis`) and `MIN_SUPPORTING_EDITS = 2` are both hard floors — a candidate needs both the base eligibility floor and its own repeated support.
- The check route is idempotent per `(websiteId, clientProfileId, targetField)`: an unchanged fingerprint returns the stored outcome without a new LLM call. No time-based cooldown — the fingerprint comparison *is* the cooldown.
- No new dashboard tab, no mobile bottom-nav entry, no badge/counter anywhere in this slice.
- Cross-tenant isolation on both new routes: a foreign `websiteId` or candidate `id` must 404, not leak data — same `resolveWebsiteForRequest` chokepoint every other per-site route uses.
- Every task must leave `npx vitest run`, `npx tsc --noEmit`, and `npx next build` green.

---

### Task 1: Schema — `PreferenceCandidate` + `PreferenceCandidateCheck`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_preference_candidates/migration.sql` (via `prisma migrate dev`)

**Interfaces:**
- Produces: `PreferenceCandidate` and `PreferenceCandidateCheck` Prisma models.

- [ ] **Step 1: Add both models**

Add to `prisma/schema.prisma`, after the existing `FeedbackAnalysis` model:

```prisma
model PreferenceCandidate {
  id                     String    @id @default(cuid())
  clientProfileId        String
  clientProfile          ClientProfile @relation(fields: [clientProfileId], references: [id])
  websiteId              String
  website                Website   @relation(fields: [websiteId], references: [id])
  targetField            String
  originalProposedPhrase String
  customerEditedPhrase   String?
  rationale               String
  evidenceEntryIds        String[]
  evidenceExcerpts        Json
  status                  String
  supersededById          String?
  sourceFingerprint       String
  modelVersion            String
  promptVersion           String
  generatedAt             DateTime  @default(now())
  decidedAt               DateTime?
}

model PreferenceCandidateCheck {
  id              String   @id @default(cuid())
  clientProfileId String
  clientProfile   ClientProfile @relation(fields: [clientProfileId], references: [id])
  websiteId       String
  website         Website  @relation(fields: [websiteId], references: [id])
  targetField     String
  lastFingerprint String
  lastOutcome     String
  lastCandidateId String?
  checkedAt       DateTime @default(now())

  @@unique([websiteId, clientProfileId, targetField])
}
```

Add back-relation fields to both `ClientProfile` and `Website` models. In `ClientProfile`, find:

```prisma
  websites            Website[]
  contentPieces       ContentPiece[]
```

and add two new lines after it: `preferenceCandidates PreferenceCandidate[]` and `preferenceCandidateChecks PreferenceCandidateCheck[]`.

In `Website`, find:

```prisma
  feedbackAnalysis   FeedbackAnalysis?
```

and add two new lines after it: `preferenceCandidates PreferenceCandidate[]` and `preferenceCandidateChecks PreferenceCandidateCheck[]`.

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_preference_candidates`
Expected: creates the migration file with two `CREATE TABLE` statements (plus the unique index on `PreferenceCandidateCheck`), applies cleanly, regenerates the Prisma client.

**Critical — this exact gap bit the previous slice:** if this command is run inside a sandboxed shell that blocks the Postgres port, it can silently fail to reach the database while still writing the migration file and letting `prisma generate` succeed from the schema alone (client generation needs no DB connection). A green `tsc --noEmit` afterward does NOT prove the migration reached the database. Before considering this step done, run `npx prisma migrate status` (with `DATABASE_URL` sourced from `.env.local`, outside any Bash sandbox if one is active) and confirm both new tables show as applied, not pending.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx prisma migrate status` (env sourced, unsandboxed) — expect "Database schema is up to date!" with zero pending migrations.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add PreferenceCandidate and PreferenceCandidateCheck models for Phase 8B"
```

---

### Task 2: Deterministic verification gate + LLM candidate extraction

**Files:**
- Create: `src/lib/preference-candidates.ts`
- Test: `src/lib/preference-candidates.test.ts`

**Interfaces:**
- Consumes: `EligibleEdit` type from `@/lib/feedback-analysis` (already built in Phase 8A — do not redefine it).
- Produces:
  - `export const MIN_SUPPORTING_EDITS = 2`
  - `export const CANDIDATE_MODEL = 'openai/gpt-oss-120b'`
  - `export const CANDIDATE_PROMPT_VERSION = 'v1'`
  - `export function phraseAppearsIn(phrase: string, text: string): boolean` — case-insensitive, Unicode-word-boundary-aware substring match. Mirrors the exact regex approach already established in `src/lib/audit-agents/brand-specialist.ts`'s `checkRestrictedWording` (`(?<![\p{L}\p{N}])<phrase>(?![\p{L}\p{N}])`, `'iu'` flags) — do not invent a different matching strategy.
  - `export interface CandidateVerificationResult { valid: boolean; supportingEditIds: string[]; reason?: string }`
  - `export function verifyCandidatePhrase(phrase: string, eligibleEdits: EligibleEdit[], existingPhrases: string[], restrictedWording: string[]): CandidateVerificationResult` — runs all 6 gate conditions from the design doc in order, short-circuiting on the first failure with an honest `reason` string; on success, `supportingEditIds` is the list of `auditLogEntryId`s whose `before` text contained the phrase and whose `after` text didn't (condition 1+2), filtered to only those edits, and this list's length must be `>= MIN_SUPPORTING_EDITS` (condition 3) for `valid` to be `true`. `existingPhrases` is every phrase already represented by a `proposed`/`approved_for_evaluation`/`rejected` candidate for this scope (condition 6); `restrictedWording` is the live `ClientProfile.restrictedWording` array (condition 5). Condition 4 (same-tenant evidence) is the caller's responsibility — this function only ever receives an `eligibleEdits` array the caller has already scoped correctly, and does not re-derive tenancy itself (no tenant ID parameters exist on `EligibleEdit`).
  - `export interface CandidateProposal { phrase: string; rationale: string } | null`
  - `export function buildCandidateExtractionPrompt(edits: EligibleEdit[]): string` — same no-invent discipline as `buildFeedbackSummaryPrompt`, minimized to `actionType`/`decision`/`timestamp`/before/after only, asks for structured JSON output `{"phrase": string, "rationale": string}` or the literal string `"none"` if no clear pattern exists.
  - `type CandidateCaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>`
  - `export async function proposeCandidate(edits: EligibleEdit[], callOpenAI?: CandidateCaller): Promise<CandidateProposal>` — calls the LLM, parses the JSON response defensively (malformed JSON, missing `phrase` field, or the literal `"none"` response all resolve to `null`, never throwing, never fabricating a phrase from unparseable output).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/preference-candidates.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  phraseAppearsIn,
  verifyCandidatePhrase,
  buildCandidateExtractionPrompt,
  proposeCandidate,
  MIN_SUPPORTING_EDITS,
} from './preference-candidates';
import type { EligibleEdit } from './feedback-analysis';

function edit(overrides: Partial<EligibleEdit> & { auditLogEntryId: string }): EligibleEdit {
  return {
    actionType: 'meta_description',
    before: 'Our industry-leading solution helps you grow.',
    after: 'Our solution helps you grow.',
    timestamp: new Date('2026-09-01'),
    ...overrides,
  };
}

describe('phraseAppearsIn', () => {
  it('matches case-insensitively with word boundaries', () => {
    expect(phraseAppearsIn('industry-leading', 'Our Industry-Leading solution')).toBe(true);
  });

  it('does not match a phrase embedded inside a longer word', () => {
    expect(phraseAppearsIn('lead', 'leadership team')).toBe(false);
  });

  it('returns false when the phrase is absent', () => {
    expect(phraseAppearsIn('best-in-class', 'Our solution helps you grow.')).toBe(false);
  });
});

describe('verifyCandidatePhrase', () => {
  it('accepts a phrase removed across at least MIN_SUPPORTING_EDITS distinct edits', () => {
    const edits = [
      edit({ auditLogEntryId: 'e1' }),
      edit({ auditLogEntryId: 'e2' }),
    ];
    const result = verifyCandidatePhrase('industry-leading', edits, [], []);

    expect(result.valid).toBe(true);
    expect(result.supportingEditIds.sort()).toEqual(['e1', 'e2']);
  });

  it('rejects a phrase supported by fewer than MIN_SUPPORTING_EDITS edits', () => {
    const edits = [edit({ auditLogEntryId: 'e1' })];
    const result = verifyCandidatePhrase('industry-leading', edits, [], []);

    expect(result.valid).toBe(false);
    expect(result.supportingEditIds).toHaveLength(1);
  });

  it('rejects a phrase not actually present in any before text', () => {
    const edits = [edit({ auditLogEntryId: 'e1' }), edit({ auditLogEntryId: 'e2' })];
    const result = verifyCandidatePhrase('completely fabricated phrase', edits, [], []);

    expect(result.valid).toBe(false);
    expect(result.supportingEditIds).toEqual([]);
  });

  it('rejects a phrase that still appears in the after text (not actually removed)', () => {
    const edits = [
      edit({ auditLogEntryId: 'e1', before: 'Industry-leading, industry-leading solution.', after: 'Industry-leading solution.' }),
      edit({ auditLogEntryId: 'e2', before: 'Industry-leading, industry-leading solution.', after: 'Industry-leading solution.' }),
    ];
    const result = verifyCandidatePhrase('industry-leading', edits, [], []);

    expect(result.valid).toBe(false);
  });

  it('rejects a phrase already in restrictedWording', () => {
    const edits = [edit({ auditLogEntryId: 'e1' }), edit({ auditLogEntryId: 'e2' })];
    const result = verifyCandidatePhrase('industry-leading', edits, [], ['industry-leading']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already');
  });

  it('rejects a phrase already represented by an existing candidate', () => {
    const edits = [edit({ auditLogEntryId: 'e1' }), edit({ auditLogEntryId: 'e2' })];
    const result = verifyCandidatePhrase('industry-leading', edits, ['industry-leading'], []);

    expect(result.valid).toBe(false);
  });

  it(`MIN_SUPPORTING_EDITS is 2`, () => {
    expect(MIN_SUPPORTING_EDITS).toBe(2);
  });
});

describe('buildCandidateExtractionPrompt', () => {
  it('includes only actionType/decision/timestamp/before/after and asks for structured output', () => {
    const prompt = buildCandidateExtractionPrompt([edit({ auditLogEntryId: 'e1' })]);

    expect(prompt).toContain('meta_description');
    expect(prompt).toContain('industry-leading');
    expect(prompt.toLowerCase()).toContain('never invent');
    expect(prompt).toContain('phrase');
  });
});

describe('proposeCandidate', () => {
  const edits = [edit({ auditLogEntryId: 'e1' }), edit({ auditLogEntryId: 'e2' })];

  it('returns the parsed candidate on a valid JSON response', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({
      content: '{"phrase": "industry-leading", "rationale": "Removed from multiple drafts."}',
      totalTokens: 40,
    });

    const result = await proposeCandidate(edits, callOpenAI);

    expect(result).toEqual({ phrase: 'industry-leading', rationale: 'Removed from multiple drafts.' });
  });

  it('returns null on the literal "none" response', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'none', totalTokens: 5 });

    const result = await proposeCandidate(edits, callOpenAI);

    expect(result).toBeNull();
  });

  it('returns null on malformed JSON rather than throwing', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'not json at all', totalTokens: 5 });

    const result = await proposeCandidate(edits, callOpenAI);

    expect(result).toBeNull();
  });

  it('returns null when the OpenAI call fails', async () => {
    const callOpenAI = vi.fn().mockRejectedValue(new Error('rate limited'));

    const result = await proposeCandidate(edits, callOpenAI);

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/preference-candidates.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/lib/preference-candidates.ts`:

```typescript
import OpenAI from 'openai';
import type { EligibleEdit } from './feedback-analysis';

export const MIN_SUPPORTING_EDITS = 2;
export const CANDIDATE_MODEL = 'openai/gpt-oss-120b';
export const CANDIDATE_PROMPT_VERSION = 'v1';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mirrors src/lib/audit-agents/brand-specialist.ts's checkRestrictedWording matching exactly --
// case-insensitive, Unicode-letter/number word-boundary-aware, so "lead" never matches inside
// "leadership" and "industry-leading" matches regardless of surrounding punctuation/case.
export function phraseAppearsIn(phrase: string, text: string): boolean {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(text);
}

export interface CandidateVerificationResult {
  valid: boolean;
  supportingEditIds: string[];
  reason?: string;
}

// The LLM proposes; this function decides. All 6 conditions from the design doc's
// "Deterministic verification gate" section, in order, short-circuiting on the first failure.
export function verifyCandidatePhrase(
  phrase: string,
  eligibleEdits: EligibleEdit[],
  existingPhrases: string[],
  restrictedWording: string[]
): CandidateVerificationResult {
  const trimmed = phrase.trim();
  if (!trimmed) return { valid: false, supportingEditIds: [], reason: 'Empty phrase.' };

  // Conditions 5-6: not already restricted, not already represented by an existing candidate.
  const alreadyRestricted = restrictedWording.some((w) => w.trim().toLowerCase() === trimmed.toLowerCase());
  if (alreadyRestricted) return { valid: false, supportingEditIds: [], reason: 'Phrase is already in restrictedWording.' };

  const alreadyProposed = existingPhrases.some((p) => p.trim().toLowerCase() === trimmed.toLowerCase());
  if (alreadyProposed) return { valid: false, supportingEditIds: [], reason: 'Phrase already represented by an existing candidate.' };

  // Conditions 1-2: present in before, absent from after, per edit.
  const supportingEditIds = eligibleEdits
    .filter((e) => phraseAppearsIn(trimmed, e.before) && !phraseAppearsIn(trimmed, e.after))
    .map((e) => e.auditLogEntryId);

  // Condition 3: repeated support, not a single edit.
  if (supportingEditIds.length < MIN_SUPPORTING_EDITS) {
    return { valid: false, supportingEditIds, reason: `Only ${supportingEditIds.length} supporting edit(s), needs at least ${MIN_SUPPORTING_EDITS}.` };
  }

  return { valid: true, supportingEditIds };
}

export interface CandidateProposal {
  phrase: string;
  rationale: string;
}

export function buildCandidateExtractionPrompt(edits: EligibleEdit[]): string {
  const lines = edits.map(
    (e) =>
      `- Action type: ${e.actionType} | Decision: edited | Timestamp: ${e.timestamp.toISOString()}\n  Before: ${e.before}\n  After: ${e.after}`
  );
  return [
    'You look for a single repeated phrase a website owner keeps removing or replacing across their edits.',
    'Rules:',
    '- Base your answer ONLY on the edits listed below. Never invent a phrase not literally present in the "Before" text of at least two of them.',
    '- If no single phrase is clearly repeated across multiple edits, respond with exactly: none',
    '- Otherwise respond with ONLY a JSON object: {"phrase": "<the exact repeated phrase>", "rationale": "<one short sentence>"}',
    '- No markdown, no code fences, no extra text before or after the JSON.',
    '',
    'Recent edits:',
    ...lines,
  ].join('\n');
}

type CandidateCaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

async function defaultCandidateCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    timeout: 15_000,
    maxRetries: 1,
  });
  const completion = await openai.chat.completions.create({
    model: CANDIDATE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function proposeCandidate(edits: EligibleEdit[], callOpenAI: CandidateCaller = defaultCandidateCaller): Promise<CandidateProposal | null> {
  try {
    const { content } = await callOpenAI(buildCandidateExtractionPrompt(edits));
    if (!content || content.trim().toLowerCase() === 'none') return null;
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'phrase' in parsed &&
      'rationale' in parsed &&
      typeof (parsed as Record<string, unknown>).phrase === 'string' &&
      typeof (parsed as Record<string, unknown>).rationale === 'string' &&
      (parsed as { phrase: string }).phrase.trim()
    ) {
      return { phrase: (parsed as CandidateProposal).phrase.trim(), rationale: (parsed as CandidateProposal).rationale.trim() };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/preference-candidates.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/preference-candidates.ts src/lib/preference-candidates.test.ts
git commit -m "feat: add deterministic verification gate and LLM candidate extraction"
```

---

### Task 3: API route — `POST /api/websites/[id]/preference-candidates/check`

**Files:**
- Create: `src/app/api/websites/[id]/preference-candidates/check/route.ts`
- Test: `src/app/api/websites/[id]/preference-candidates/check/route.test.ts`

**Interfaces:**
- Consumes: `extractEligibleEdits`, `computeSourceFingerprint`, `MIN_EDITS_FOR_SUMMARY` from `@/lib/feedback-analysis`; `verifyCandidatePhrase`, `proposeCandidate`, `CANDIDATE_MODEL`, `CANDIDATE_PROMPT_VERSION` from `@/lib/preference-candidates`; `resolveWebsiteForRequest`, `WebsiteNotFoundError` from `@/lib/customer`; `db` from `@/lib/db`.
- Produces: the route handler. Response body: `{ outcome: 'candidate_created' | 'no_pattern' | 'below_threshold' | 'failed', candidate?: { id, originalProposedPhrase, rationale, evidenceExcerpts } }`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/websites/[id]/preference-candidates/check/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { proposeCandidate } from '@/lib/preference-candidates';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findMany: vi.fn() },
    auditLogEntry: { findMany: vi.fn() },
    clientProfile: { findUnique: vi.fn() },
    preferenceCandidate: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    preferenceCandidateCheck: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/preference-candidates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preference-candidates')>('@/lib/preference-candidates');
  return { ...actual, proposeCandidate: vi.fn() };
});

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/websites/w1/preference-candidates/check', { method: 'POST' }) as unknown as NextRequest;
}

function editedAction(id: string) {
  return { id, actionType: 'meta_description', status: 'edited', draftContent: 'Our solution helps you grow.' };
}

function editedEntry(id: string, actionId: string, daysAgo: number) {
  return {
    id,
    actionId,
    detail: { decision: 'edited', originalDraftContent: 'Our industry-leading solution helps you grow.' },
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

describe('POST /api/websites/[id]/preference-candidates/check', () => {
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

  it('returns below_threshold without calling the model when fewer than 5 eligible edits exist', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([editedAction('a1')]);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([editedEntry('e1', 'a1', 1)]);

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('below_threshold');
    expect(proposeCandidate).not.toHaveBeenCalled();
  });

  it('returns the stored outcome without a new LLM call when the fingerprint is unchanged', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const actions = ['a1', 'a2', 'a3', 'a4', 'a5'].map(editedAction);
    const entries = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    const { computeSourceFingerprint, extractEligibleEdits } = await vi.importActual<typeof import('@/lib/feedback-analysis')>('@/lib/feedback-analysis');
    const actionsById = new Map(actions.map((a) => [a.id, { actionType: a.actionType, draftContent: a.draftContent }]));
    const eligible = extractEligibleEdits(entries, actionsById);
    const fingerprint = computeSourceFingerprint(eligible);
    (db.preferenceCandidateCheck.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      lastFingerprint: fingerprint,
      lastOutcome: 'no_pattern',
      lastCandidateId: null,
    });

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('no_pattern');
    expect(proposeCandidate).not.toHaveBeenCalled();
  });

  it('creates a candidate when the LLM proposal passes the verification gate', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const actions = ids.map(editedAction);
    const entries = ids.map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (db.preferenceCandidateCheck.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [] });
    (db.preferenceCandidate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (proposeCandidate as ReturnType<typeof vi.fn>).mockResolvedValue({ phrase: 'industry-leading', rationale: 'Removed repeatedly.' });
    (db.preferenceCandidate.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cand1', originalProposedPhrase: 'industry-leading', rationale: 'Removed repeatedly.', evidenceExcerpts: [] });
    (db.preferenceCandidateCheck.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('candidate_created');
    expect(body.candidate.originalProposedPhrase).toBe('industry-leading');
    expect(db.preferenceCandidate.create).toHaveBeenCalledTimes(1);
    expect(db.preferenceCandidateCheck.upsert).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/websites/\[id\]/preference-candidates/check/route.test.ts`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/websites/[id]/preference-candidates/check/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { extractEligibleEdits, computeSourceFingerprint, MIN_EDITS_FOR_SUMMARY } from '@/lib/feedback-analysis';
import { verifyCandidatePhrase, proposeCandidate, CANDIDATE_MODEL, CANDIDATE_PROMPT_VERSION } from '@/lib/preference-candidates';

const TARGET_FIELD = 'restrictedWording';

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
    return NextResponse.json({ outcome: 'below_threshold' });
  }

  const fingerprint = computeSourceFingerprint(eligibleEdits);

  const lastCheck = await db.preferenceCandidateCheck.findUnique({
    where: { websiteId_clientProfileId_targetField: { websiteId: website.id, clientProfileId: website.clientProfileId, targetField: TARGET_FIELD } },
  });

  if (lastCheck && lastCheck.lastFingerprint === fingerprint) {
    return NextResponse.json({ outcome: lastCheck.lastOutcome });
  }

  const clientProfile = await db.clientProfile.findUnique({
    where: { id: website.clientProfileId },
    select: { restrictedWording: true },
  });

  const existingCandidates = await db.preferenceCandidate.findMany({
    where: { websiteId: website.id, clientProfileId: website.clientProfileId, targetField: TARGET_FIELD, status: { in: ['proposed', 'approved_for_evaluation', 'rejected'] } },
    select: { id: true, originalProposedPhrase: true, customerEditedPhrase: true, status: true },
  });
  const existingPhrases = existingCandidates.map((c) => c.customerEditedPhrase ?? c.originalProposedPhrase);

  const proposal = await proposeCandidate(eligibleEdits);

  let outcome: 'candidate_created' | 'no_pattern' = 'no_pattern';
  let createdCandidate: { id: string; originalProposedPhrase: string; rationale: string; evidenceExcerpts: unknown } | null = null;

  if (proposal) {
    const verification = verifyCandidatePhrase(proposal.phrase, eligibleEdits, existingPhrases, clientProfile?.restrictedWording ?? []);
    if (verification.valid) {
      const supportingEdits = eligibleEdits.filter((e) => verification.supportingEditIds.includes(e.auditLogEntryId));

      // A prior `proposed` candidate for this scope is superseded, not silently discarded,
      // when a fresh check produces a materially different phrase.
      const priorProposed = existingCandidates.find((c) => c.status === 'proposed');

      createdCandidate = await db.preferenceCandidate.create({
        data: {
          clientProfileId: website.clientProfileId,
          websiteId: website.id,
          targetField: TARGET_FIELD,
          originalProposedPhrase: proposal.phrase,
          rationale: proposal.rationale,
          evidenceEntryIds: verification.supportingEditIds,
          evidenceExcerpts: supportingEdits.map((e) => ({ auditLogEntryId: e.auditLogEntryId, before: e.before, after: e.after })),
          status: 'proposed',
          sourceFingerprint: fingerprint,
          modelVersion: CANDIDATE_MODEL,
          promptVersion: CANDIDATE_PROMPT_VERSION,
        },
      });

      if (priorProposed) {
        await db.preferenceCandidate.update({
          where: { id: priorProposed.id },
          data: { status: 'superseded', supersededById: createdCandidate.id, decidedAt: new Date() },
        });
      }

      outcome = 'candidate_created';
    }
  }

  await db.preferenceCandidateCheck.upsert({
    where: { websiteId_clientProfileId_targetField: { websiteId: website.id, clientProfileId: website.clientProfileId, targetField: TARGET_FIELD } },
    create: {
      websiteId: website.id,
      clientProfileId: website.clientProfileId,
      targetField: TARGET_FIELD,
      lastFingerprint: fingerprint,
      lastOutcome: outcome,
      lastCandidateId: createdCandidate?.id ?? null,
    },
    update: {
      lastFingerprint: fingerprint,
      lastOutcome: outcome,
      lastCandidateId: createdCandidate?.id ?? null,
      checkedAt: new Date(),
    },
  });

  return NextResponse.json({
    outcome,
    ...(createdCandidate
      ? { candidate: { id: createdCandidate.id, originalProposedPhrase: createdCandidate.originalProposedPhrase, rationale: createdCandidate.rationale, evidenceExcerpts: createdCandidate.evidenceExcerpts } }
      : {}),
  });
}
```

Note: the `where` clause using `websiteId_clientProfileId_targetField` is Prisma's generated compound-unique-index accessor name for the `@@unique([websiteId, clientProfileId, targetField])` constraint from Task 1 — confirm this exact generated name against the Prisma client after Task 1's migration (Prisma names it by joining the fields with underscores in schema-declaration order; if it differs, use whatever name `npx prisma generate` actually produced).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/websites/\[id\]/preference-candidates/check/route.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/websites/\[id\]/preference-candidates
git commit -m "feat: add preference-candidates check route"
```

---

### Task 4: API route — `POST /api/preference-candidates/[id]/decide`

**Files:**
- Create: `src/app/api/preference-candidates/[id]/decide/route.ts`
- Test: `src/app/api/preference-candidates/[id]/decide/route.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`; `auth` from `@clerk/nextjs/server`.
- Produces: the route handler. Request body: `{ decision: 'evaluate' | 'reject', editedPhrase?: string }`. Response: `{ status: string }` on success.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/preference-candidates/[id]/decide/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    preferenceCandidate: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

function makeRequest(body: object): NextRequest {
  return new Request('http://localhost:3000/api/preference-candidates/cand1/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/preference-candidates/[id]/decide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest({ decision: 'evaluate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the candidate belongs to a different customer', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'proposed',
      clientProfile: { customerId: 'someone-elses-customer' },
    });

    const res = await POST(makeRequest({ decision: 'evaluate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(404);
    expect(db.preferenceCandidate.update).not.toHaveBeenCalled();
  });

  it('returns 400 for an already-decided candidate', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'rejected',
      clientProfile: { customerId: 'cust1' },
    });

    const res = await POST(makeRequest({ decision: 'evaluate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
  });

  it('sets approved_for_evaluation and never touches ClientProfile', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'proposed',
      clientProfile: { customerId: 'cust1' },
    });
    (db.preferenceCandidate.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cand1', status: 'approved_for_evaluation' });

    const res = await POST(makeRequest({ decision: 'evaluate', editedPhrase: 'best-in-class' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('approved_for_evaluation');
    expect(db.preferenceCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand1' },
      data: { status: 'approved_for_evaluation', customerEditedPhrase: 'best-in-class', decidedAt: expect.any(Date) },
    });
  });

  it('sets rejected with no editedPhrase change', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'proposed',
      clientProfile: { customerId: 'cust1' },
    });
    (db.preferenceCandidate.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cand1', status: 'rejected' });

    const res = await POST(makeRequest({ decision: 'reject' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('rejected');
    expect(db.preferenceCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand1' },
      data: { status: 'rejected', customerEditedPhrase: undefined, decidedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/preference-candidates/\[id\]/decide/route.test.ts`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/preference-candidates/[id]/decide/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const body = await req.json();
  const { decision, editedPhrase } = body as { decision: 'evaluate' | 'reject'; editedPhrase?: string };

  const candidate = await db.preferenceCandidate.findUnique({
    where: { id: params.id },
    include: { clientProfile: { select: { customerId: true } } },
  });

  if (!candidate || candidate.clientProfile.customerId !== customer.id) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (candidate.status !== 'proposed') {
    return NextResponse.json({ error: 'This candidate has already been decided.' }, { status: 400 });
  }

  const status = decision === 'evaluate' ? 'approved_for_evaluation' : 'rejected';

  const updated = await db.preferenceCandidate.update({
    where: { id: params.id },
    data: {
      status,
      customerEditedPhrase: decision === 'evaluate' ? editedPhrase : undefined,
      decidedAt: new Date(),
    },
  });

  return NextResponse.json({ status: updated.status });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/preference-candidates/\[id\]/decide/route.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/preference-candidates
git commit -m "feat: add preference-candidate decide route"
```

---

### Task 5: UI — `PreferenceSuggestionCard`

**Files:**
- Create: `src/components/review/preference-suggestion-card.tsx`
- Test: `src/components/review/preference-suggestion-card.test.tsx`

This codebase has no `@testing-library/react`/jsdom (`vitest.config.ts` uses `environment: 'node'`) — same established precedent as `bottom-nav.test.tsx` and Phase 8A's `feedback-patterns-card.tsx`. Extract and test only pure decision logic; the component itself (hooks, fetch, rendering) is verified visually in the final task, not unit-rendered.

**Interfaces:**
- Props:
  ```typescript
  interface PreferenceSuggestionCardProps {
    checkWebsiteIds: string[];
    initialCandidate: { id: string; originalProposedPhrase: string; rationale: string; evidenceExcerpts: { auditLogEntryId: string; before: string; after: string }[] } | null;
  }
  ```
- Produces:
  - `export function formatSuggestionCopy(phrase: string, supportingEditCount: number): string` — pure. Returns e.g. `Dex noticed a pattern — You removed "industry-leading" from 4 drafts. Should Dex evaluate avoiding this phrase in future drafts?` (exact customer-facing copy from the design doc, phrase and count interpolated).
  - `export function PreferenceSuggestionCard(props: PreferenceSuggestionCardProps)` — client component (`'use client'`). On mount, if `initialCandidate` is null and `checkWebsiteIds.length > 0`, fires `POST /api/websites/${id}/preference-candidates/check` for each id in sequence (stopping at the first `candidate_created` result) using `fetch`; renders nothing while no candidate is present, renders the card once one resolves (from `initialCandidate` or the check). "Evaluate this preference" and "Not a preference" buttons `POST` to `/api/preference-candidates/${id}/decide` and hide the card locally on success. Includes an expandable disclosure showing `evidenceExcerpts` (the real before/after snippets — never model/prompt version or fingerprint). Always renders the line "Active preferences remain unchanged until Dex finishes evaluating." once a candidate is shown.

- [ ] **Step 1: Write the failing tests**

Create `src/components/review/preference-suggestion-card.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatSuggestionCopy } from './preference-suggestion-card';

describe('formatSuggestionCopy', () => {
  it('includes the phrase and the real supporting-edit count', () => {
    const copy = formatSuggestionCopy('industry-leading', 4);

    expect(copy).toContain('industry-leading');
    expect(copy).toContain('4 drafts');
    expect(copy).toContain('Dex noticed a pattern');
  });

  it('uses singular "draft" for a count of 1', () => {
    const copy = formatSuggestionCopy('industry-leading', 1);

    expect(copy).toContain('1 draft');
    expect(copy).not.toContain('1 drafts');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/review/preference-suggestion-card.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the component**

Create `src/components/review/preference-suggestion-card.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function formatSuggestionCopy(phrase: string, supportingEditCount: number): string {
  const draftWord = supportingEditCount === 1 ? 'draft' : 'drafts';
  return `Dex noticed a pattern — You removed "${phrase}" from ${supportingEditCount} ${draftWord}. Should Dex evaluate avoiding this phrase in future drafts?`;
}

interface Candidate {
  id: string;
  originalProposedPhrase: string;
  rationale: string;
  evidenceExcerpts: { auditLogEntryId: string; before: string; after: string }[];
}

interface PreferenceSuggestionCardProps {
  checkWebsiteIds: string[];
  initialCandidate: Candidate | null;
}

export function PreferenceSuggestionCard({ checkWebsiteIds, initialCandidate }: PreferenceSuggestionCardProps) {
  const [candidate, setCandidate] = useState<Candidate | null>(initialCandidate);
  const [dismissed, setDismissed] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (candidate || checkWebsiteIds.length === 0) return;
    let cancelled = false;

    async function runChecks() {
      for (const websiteId of checkWebsiteIds) {
        try {
          const res = await fetch(`/api/websites/${websiteId}/preference-candidates/check`, { method: 'POST' });
          if (!res.ok) continue;
          const body = await res.json();
          if (!cancelled && body.outcome === 'candidate_created' && body.candidate) {
            setCandidate(body.candidate);
            return;
          }
        } catch {
          // Non-blocking by design -- a failed check silently leaves the Review page usable
          // with no suggestion shown, same as if nothing had been found.
        }
      }
    }

    runChecks();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(decision: 'evaluate' | 'reject') {
    if (!candidate) return;
    setDeciding(true);
    try {
      const res = await fetch(`/api/preference-candidates/${candidate.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) setDismissed(true);
    } finally {
      setDeciding(false);
    }
  }

  if (!candidate || dismissed) return null;

  return (
    <Card className="border-accent/40">
      <CardContent className="flex flex-col gap-3 pt-6">
        <p className="text-sm text-foreground">{formatSuggestionCopy(candidate.originalProposedPhrase, candidate.evidenceExcerpts.length)}</p>
        <p className="text-xs text-muted-foreground">Active preferences remain unchanged until Dex finishes evaluating.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => decide('evaluate')} disabled={deciding}>
            Evaluate this preference
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide('reject')} disabled={deciding}>
            Not a preference
          </Button>
        </div>
        <button type="button" className="text-left text-xs text-muted-foreground underline" onClick={() => setShowEvidence((v) => !v)}>
          {showEvidence ? 'Hide' : 'Why Dex suggested this'}
        </button>
        {showEvidence && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
            {candidate.evidenceExcerpts.map((e) => (
              <div key={e.auditLogEntryId}>
                <p className="text-muted-foreground line-through">{e.before}</p>
                <p className="text-foreground">{e.after}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/review/preference-suggestion-card.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full check**

Run: `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/review/preference-suggestion-card.tsx src/components/review/preference-suggestion-card.test.tsx
git commit -m "feat: add PreferenceSuggestionCard component"
```

---

### Task 6: Wire into the Review page

**Files:**
- Modify: `src/app/review/page.tsx`

**Interfaces:**
- Consumes: `PreferenceSuggestionCard` (Task 5); `db` (existing, already imported).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Add the import**

In `src/app/review/page.tsx`, add near the other component imports (after the `ActionDetail` import):

```typescript
import { PreferenceSuggestionCard } from '@/components/review/preference-suggestion-card';
```

- [ ] **Step 2: Compute which websites may need a check, and whether a proposed candidate already exists**

After the existing `const customer = await db.customer.findUnique(...)` block and before `pendingActions` is queried, add:

```typescript
  const websites = await db.website.findMany({ where: { clientProfile: { customerId: customer.id } }, select: { id: true } });

  const existingProposed = await db.preferenceCandidate.findFirst({
    where: { website: { clientProfile: { customerId: customer.id } }, status: 'proposed' },
    select: { id: true, originalProposedPhrase: true, rationale: true, evidenceExcerpts: true },
    orderBy: { generatedAt: 'desc' },
  });

  const checkWebsiteIds = existingProposed ? [] : websites.map((w) => w.id);
```

This mirrors the read-only, cheap-only rule from the design doc: no LLM call happens during this render — `existingProposed` is a plain indexed lookup, and `checkWebsiteIds` is just an array of IDs for the client component to check client-side, only when nothing is already pending.

- [ ] **Step 3: Render the card**

Directly after the `<h1>`/`<p>` header block (right after the closing `</p>` that shows the pending-changes count, before the `{pendingActions.length === 0 ? (` block), add:

```tsx
      <div className="mt-6">
        <PreferenceSuggestionCard
          checkWebsiteIds={checkWebsiteIds}
          initialCandidate={
            existingProposed
              ? {
                  id: existingProposed.id,
                  originalProposedPhrase: existingProposed.originalProposedPhrase,
                  rationale: existingProposed.rationale,
                  evidenceExcerpts: existingProposed.evidenceExcerpts as { auditLogEntryId: string; before: string; after: string }[],
                }
              : null
          }
        />
      </div>
```

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run` — expect all tests passing, including the new ones.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx next build` — expect clean, `/review`, `/api/websites/[id]/preference-candidates/check`, and `/api/preference-candidates/[id]/decide` all present in the route table.

- [ ] **Step 6: Commit**

```bash
git add src/app/review/page.tsx
git commit -m "feat: wire PreferenceSuggestionCard into the Review page"
```

---

### Task 7: UI — Settings "Learning" section

**Files:**
- Modify: `src/app/settings/page.tsx`
- Create: `src/components/settings/learning-section.tsx`
- Test: `src/components/settings/learning-section.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks beyond the `PreferenceCandidate` shape already established.
- Produces: `export function formatCandidateStatusLabel(status: string): string` — pure, maps internal status strings to customer-facing labels (`'proposed'` → `'Pending'`, `'approved_for_evaluation'` → `'Evaluating'`, `'rejected'` → `'Not a preference'`, `'superseded'` → `'Replaced by a newer suggestion'`). `export function LearningSection(props: { candidates: CandidateRow[] })` — server-renderable (no hooks needed — this is a read-only list), so no client/server test-pattern constraint applies here the way it did for Task 5.

- [ ] **Step 1: Write the failing tests**

Create `src/components/settings/learning-section.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatCandidateStatusLabel } from './learning-section';

describe('formatCandidateStatusLabel', () => {
  it('maps every known internal status to honest customer wording', () => {
    expect(formatCandidateStatusLabel('proposed')).toBe('Pending');
    expect(formatCandidateStatusLabel('approved_for_evaluation')).toBe('Evaluating');
    expect(formatCandidateStatusLabel('rejected')).toBe('Not a preference');
    expect(formatCandidateStatusLabel('superseded')).toBe('Replaced by a newer suggestion');
  });

  it('falls back to the raw status for an unrecognized value rather than a made-up label', () => {
    expect(formatCandidateStatusLabel('some_future_status')).toBe('some_future_status');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/settings/learning-section.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `src/components/settings/learning-section.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Pending',
  approved_for_evaluation: 'Evaluating',
  rejected: 'Not a preference',
  superseded: 'Replaced by a newer suggestion',
};

export function formatCandidateStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export interface CandidateRow {
  id: string;
  originalProposedPhrase: string;
  customerEditedPhrase: string | null;
  status: string;
  generatedAt: Date;
}

export function LearningSection({ candidates }: { candidates: CandidateRow[] }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Learning</CardTitle>
        <CardDescription>
          Suggested preferences Dex has noticed from your edits. Active preferences remain unchanged until a suggestion
          finishes evaluating.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet — Dex hasn't noticed a repeated pattern in your edits.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 rounded-md border border-border p-3 text-sm">
                <span className="text-foreground">"{c.customerEditedPhrase ?? c.originalProposedPhrase}"</span>
                <span className="text-xs text-muted-foreground">{formatCandidateStatusLabel(c.status)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/settings/learning-section.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 5: Wire into Settings page**

In `src/app/settings/page.tsx`, add the import near the other `@/components/settings/*` imports:

```typescript
import { LearningSection } from '@/components/settings/learning-section';
```

After the existing `const clientProfile = ...` block, add:

```typescript
  const candidates = clientProfile
    ? await db.preferenceCandidate.findMany({
        where: { clientProfileId: clientProfile.id },
        select: { id: true, originalProposedPhrase: true, customerEditedPhrase: true, status: true, generatedAt: true },
        orderBy: { generatedAt: 'desc' },
        take: 20,
      })
    : [];
```

Find where the existing `<Card>` blocks render in the page's JSX (after the `BrandPreferencesForm`-containing card, matching this page's existing card-per-section layout) and add:

```tsx
      <LearningSection candidates={candidates} />
```

- [ ] **Step 6: Run the full check**

Run: `npx vitest run` — expect all passing.
Run: `npx tsc --noEmit` — expect clean.
Run: `npx next build` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/learning-section.tsx src/components/settings/learning-section.test.tsx src/app/settings/page.tsx
git commit -m "feat: add Learning section to Settings"
```

---

### Task 8: Full regression, browser verification, and deploy

**Files:** none (verification + deployment only)

- [ ] **Step 1: Full verification**

Run in order: `npx vitest run`, `npx tsc --noEmit`, `npx next build`. All must pass. Restart any live local dev server afterward (this codebase's build corrupts a live dev server's chunk manifest).

- [ ] **Step 2: Migration integrity, outside the sandbox**

Run (env sourced from `.env.local`, unsandboxed): `npx prisma migrate status` — confirm both new tables show applied, zero pending. Do not trust a green `tsc --noEmit` alone for this, per the exact gap that hit Phase 8A's Task 1.

- [ ] **Step 3: Visual verification on real data**

Using the project's `browse` skill against an authenticated session: navigate to `/review` for a real website with 5+ real edited drafts sharing a repeated removed phrase (or, if no such real data exists, note this honestly and verify instead that the below-threshold/no-pattern paths render correctly and the page stays fully usable with no card). Confirm the card's exact copy matches the design doc, confirm "Active preferences remain unchanged" is visible, confirm the evidence disclosure shows real before/after text, confirm clicking "Not a preference" or "Evaluate this preference" hides the card. Navigate to `/settings`, confirm the Learning section renders with correct status labels. Screenshot each state, save to `docs/superpowers/evidence/2026-09-17-responsive-release-gate/after/suggested-preferences/`.

- [ ] **Step 4: Independent review**

Dispatch a fresh subagent (no shared context) as an independent reviewer, checking specifically: does the deterministic verification gate actually block a fabricated/unsupported phrase from ever reaching a created `PreferenceCandidate` row (trace the real code path, don't trust the report)? Does the check route's idempotency genuinely prevent a duplicate LLM call for an unchanged fingerprint? Does the decide route's tenant scoping (`candidate.clientProfile.customerId !== customer.id`) actually block a cross-tenant decision? Does anything in this feature write to `ClientProfile.restrictedWording` anywhere (grep for it across every new/touched file — there must be zero matches)? Report findings; fix anything real before deploying.

- [ ] **Step 5: Deploy**

```bash
npx prisma migrate deploy
vercel deploy --prod --yes
```

Confirm the alias: `vercel inspect dex-ai-plum.vercel.app` — printed `id` must match the deployment just created.

- [ ] **Step 6: Record completion**

Append a section to `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md` (matching this session's established per-slice entries): what shipped, commit SHAs, deployment id, the accurate completion statement (Dex now automatically notices repeated edit patterns and surfaces one contextual suggestion in Review; approving only queues it for future evaluation and does not change any active preference), and explicit confirmation nothing writes to `ClientProfile` yet.

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "docs: record Phase 8B suggested preferences completion"
```

---

## Self-Review Notes

- **Spec coverage:** deterministic verification gate with all 6 conditions (Task 2), idempotent non-blocking trigger via the check-ledger (Task 3), inert decide route (Task 4), customer-facing card copy + evidence disclosure + "active preferences unchanged" messaging (Task 5), Review-page wiring with cheap-only server render (Task 6), Settings Learning section with honest status labels (Task 7), migration-integrity lesson explicitly carried forward from Phase 8A (Task 1, Task 8) — all covered.
- **Placeholder scan:** none found.
- **Type consistency:** `EligibleEdit` (Phase 8A) reused unchanged, not redefined. `CandidateVerificationResult`/`verifyCandidatePhrase` (Task 2) signature matches its usage in Task 3. `PreferenceCandidateCheck`'s compound-unique accessor name is flagged as needing confirmation against the actual generated Prisma client rather than assumed, since Prisma's naming convention for multi-field `@@unique` constraints should be verified against the real generated client, not guessed twice.
- **Risk flagged for the implementer (Task 3):** the exact database write pattern for the "supersede a prior proposed candidate" logic uses two separate `create`/`update` calls rather than a transaction — acceptable for this slice (a failure between them leaves an orphaned old `proposed` row rather than corrupting data, self-healing on the next check), but worth a `db.$transaction([...])` wrap if this route's write volume ever grows enough to make the race window matter.
