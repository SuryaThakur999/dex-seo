# Dex Week 2: Growth Brain, Creation Engine, GrowthGuard-lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-implementation amendment (2026-08-19):** the final whole-branch review found this plan's own Task 6 reference code had a real safety gap, fixed in commit `14a7792` on top of the work below:
> 1. The pipeline flagged and drafted against ANY page with a missing `metaDescription`, without distinguishing "page genuinely has no meta description" from "the crawl failed entirely" (robots-disallowed, non-200, network error — all of which also return `metaDescription: null`). A page that failed to crawl still got a real OpenAI draft grounded in nothing but its URL, and because GrowthGuard's contradiction/claims checks can't fire against empty source text, a plausible invented draft could pass all 5 checks and auto-approve. Fixed by skipping any page where `title`, `h1`, and `metaDescription` are all null after crawling — those never reach the flag/draft stage.
> 2. The safety-critical `Action.status` decision (whether a GrowthGuard PASS + `autoExecuteEnabled` skips manual review) had zero test coverage. Fixed by extracting it into an exported `decideActionStatus()` function in `growth-guard.ts` with all 6 outcome × toggle combinations tested.
> 3. The duplicate-risk check compared a page's draft against its own prior drafts, not other pages' drafts as the spec's "cannibalization check" framing intends. Fixed by scoping the recent-drafts query to exclude the current page's own `pageUrl`.
>
> Also fixed in the same pass: no per-page error isolation in the draft/guard loop (one page's OpenAI failure aborted the whole scan and lost the response summary for already-committed rows), no explicit timeout/retry bounds on the OpenAI client (SDK defaults are a 10-minute timeout with 2 retries — could exceed the route's own `maxDuration`), and silent error swallowing in both catch blocks.
>
> Left as-is, tracked for Week 3 rather than fixed here (product/infrastructure design decisions, not quick patches): the pipeline's realistic latency (crawl throttling + up to 10 sequential OpenAI calls + DB writes, all synchronous in one request) likely exceeds Vercel Hobby's 10s limit and is marginal even under Pro's 60s ceiling — needs a background-job redesign, not a cap reduction. Separately, an already-approved `Action` gets re-flagged and re-drafted (burning a real OpenAI call) on every subsequent scan of the same unchanged page, since Phase 1 has no CMS write-back to signal the live page was actually fixed — under auto-execute this repeats indefinitely and becomes a real, unbounded cost problem. Both are documented in the Week 2 SDD ledger with fuller reasoning.

**Goal:** Wire the full Dex Phase 1 pipeline — crawl → Growth Brain flagging → Creation Engine (OpenAI) draft → GrowthGuard-lite checklist → `Action`/`GuardResult` persistence — into the existing `/api/scan` route, so each "Scan my site" click produces real, checked drafts in the database, not just a page listing.

**Architecture:** Four new pure-logic-first modules (`growth-brain.ts`, `creation-engine.ts`, `growth-guard.ts`, plus a small extension to `gsc-client.ts` for page performance metrics) get built and unit-tested independently, then wired together in `/api/scan/route.ts`. `growth-guard.ts` is deliberately synchronous, DB-free pure logic (per ADR 0004: a hardcoded checklist, not a model) so its 5 checks are cheap to test exhaustively. The crawler gains one more field (`h1`) since the spec requires grounding the LLM in "title, existing meta, headings," not just title/meta.

**Tech Stack:** Adds the `openai` npm package (official SDK) to the existing Next.js 14 / Prisma / Clerk / GSC stack from Week 1.

## Global Constraints

- GrowthGuard is a fixed rule checklist, not a scored/weighted model. (ADR 0004)
- `Customer.autoExecuteEnabled` only ever changes what happens to a PASS outcome (`Action.status` becomes `"approved"` instead of `"pending"`). FLAG and BLOCK outcomes are unconditionally `"pending"` regardless of the toggle — there is no code path where a flagged or blocked action skips human review. (ADR 0003, spec Section 3-4)
- **Hard-fail checks → `outcome: "block"`:** AI-content disclosure missing, unverifiable factual claims present, contradicts source content. **Soft-fail checks → `outcome: "flag"`:** length over ~155 chars, near-duplicate of another recent draft for the same customer. (spec Section 3; the unverifiable-claims check is grouped with disclosure/contradiction as hard-fail here because the spec's own table labels it a "Hallucination check" — a plan-level classification decision made explicit here so no task has to guess.)
- One OpenAI call per flagged page, grounded ONLY in the crawled page content passed to it (title, existing meta, H1) — never let the model invent facts not in that context. (spec Section 6)
- `Action.tokenCost` logged on every OpenAI call. (spec Section 6)
- No CMS write-back, no Review UI, no Learning Engine, no scored GrowthGuard — those are Week 3 or later. This week only needs to produce correct `Action`/`GuardResult` rows in the database; nothing renders them yet.
- Secrets (`OPENAI_API_KEY`) live only in `.env.local` / host env vars, already covered by the existing `.env*` gitignore rule from Week 1 — no `.gitignore` changes needed this week.

---

## File Structure

```
src/lib/
  crawler.ts          (MODIFY — add h1 to parsePageMeta/fetchPageMeta)
  gsc-client.ts        (MODIFY — add listPagePerformance/extractPagePerformance)
  growth-brain.ts      (NEW — pure flagPages() function)
  creation-engine.ts   (NEW — draftMetaDescription() OpenAI call)
  growth-guard.ts       (NEW — pure runGrowthGuard() checklist)
src/app/api/scan/route.ts  (MODIFY — orchestrates the full pipeline)
```

One responsibility per file: `growth-brain.ts` only decides WHICH pages need a new draft (pure function, no I/O). `creation-engine.ts` only turns page content into a drafted meta description (the only file that talks to OpenAI). `growth-guard.ts` only judges a draft against the 5 rules (pure function, no I/O, no LLM call). `/api/scan/route.ts` is the only place that ties GSC + crawler + Growth Brain + Creation Engine + GrowthGuard + Prisma together.

---

### Task 1: Crawler — Add H1 Heading to Page Content

**Files:**
- Modify: `src/lib/crawler.ts`
- Modify: `src/lib/crawler.test.ts`

**Interfaces:**
- Produces: `parsePageMeta(html: string): { title: string | null; metaDescription: string | null; h1: string | null }` and `fetchPageMeta(url, fetchImpl?): Promise<{ title: string | null; metaDescription: string | null; h1: string | null }>` — the `h1` field is new; `title`/`metaDescription` behavior is unchanged. Task 6 (`/api/scan`) consumes this new shape directly.

- [ ] **Step 1: Update the three existing `parsePageMeta`/`fetchPageMeta` tests to expect the new `h1` field**

In `src/lib/crawler.test.ts`, update these three existing assertions (only the expected objects change — nothing else in the file):

```ts
// "extracts the title and meta description from HTML" — change the html fixture and expectation to:
it('extracts the title, meta description, and h1 from HTML', () => {
  const html = `
    <html><head>
      <title>Example Page</title>
      <meta name="description" content="An example page for testing.">
    </head><body>
      <h1>Example Heading</h1>
    </body></html>
  `;
  expect(parsePageMeta(html)).toEqual({
    title: 'Example Page',
    metaDescription: 'An example page for testing.',
    h1: 'Example Heading',
  });
});
```

```ts
// "returns nulls when title or meta description are missing" — add h1: null:
it('returns nulls when title, meta description, or h1 are missing', () => {
  expect(parsePageMeta('<html><head></head></html>')).toEqual({
    title: null,
    metaDescription: null,
    h1: null,
  });
});
```

In the `fetchPageMeta` describe block, update these two `toEqual` assertions:

```ts
// "does not fetch the page and returns nulls when robots.txt disallows it":
expect(result).toEqual({ title: null, metaDescription: null, h1: null });
```

```ts
// "fetches and parses meta for a page robots.txt allows" — update the fake HTML fixture and expectation:
const fetchImpl = vi.fn(async (url: string) => {
  if (url.endsWith('/robots.txt')) {
    return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
  }
  return {
    ok: true,
    text: async () =>
      '<html><head><title>Allowed</title><meta name="description" content="OK page."></head><body><h1>Allowed Heading</h1></body></html>',
  } as Response;
});

const result = await fetchPageMeta('https://allowed-path.example.com/blog/post', fetchImpl as unknown as typeof fetch);

expect(result).toEqual({ title: 'Allowed', metaDescription: 'OK page.', h1: 'Allowed Heading' });
```

The `'matches a meta description tag with an uppercase name attribute'` test and the `isAllowedByRobots`/`throttle`/`'reuses a cached robots.txt...'` tests are unaffected — leave them exactly as they are.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/crawler.test.ts`
Expected: FAIL — actual objects are missing the `h1` key the updated assertions now expect.

- [ ] **Step 3: Update `src/lib/crawler.ts`**

Change `parsePageMeta` and the two early-return literals in `fetchPageMeta`:

```ts
export function parsePageMeta(html: string): { title: string | null; metaDescription: string | null; h1: string | null } {
  const $ = cheerio.load(html);
  const title = $('head title').first().text().trim() || null;
  const metaDescription = $('meta[name="description" i]').attr('content')?.trim() || null;
  const h1 = $('h1').first().text().trim() || null;
  return { title, metaDescription, h1 };
}
```

```ts
export async function fetchPageMeta(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ title: string | null; metaDescription: string | null; h1: string | null }> {
  const { hostname } = new URL(url);

  const allowed = await isAllowedByRobots(url, (robotsUrl) => cachedFetchRobotsTxt(robotsUrl, fetchImpl));
  if (!allowed) {
    return { title: null, metaDescription: null, h1: null };
  }

  await throttle(hostname, 1000);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { title: null, metaDescription: null, h1: null };
    return parsePageMeta(await res.text());
  } catch {
    return { title: null, metaDescription: null, h1: null };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/crawler.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/crawler.ts src/lib/crawler.test.ts
git commit -m "feat: extend crawler to capture H1 heading for LLM grounding"
```

---

### Task 2: GSC Client — Page Performance Metrics

**Files:**
- Modify: `src/lib/gsc-client.ts`
- Modify: `src/lib/gsc-client.test.ts`

**Interfaces:**
- Produces: `interface PagePerformance { url: string; impressions: number; clicks: number; ctr: number }`, `extractPagePerformance(response): PagePerformance[]`, `listPagePerformance(refreshToken: string, siteUrl: string): Promise<PagePerformance[]>`. `extractPageUrls`/`listIndexedPages` keep their exact existing signatures (still exported, `/api/scan` doesn't have to change yet) but are now implemented on top of the new functions. Task 6 consumes `listPagePerformance`.

- [ ] **Step 1: Write the failing test for `extractPagePerformance`**

Add to `src/lib/gsc-client.test.ts` (keep the existing `extractPageUrls` tests exactly as they are — this is additive):

```ts
import { describe, it, expect } from 'vitest';
import { extractPageUrls, extractPagePerformance } from './gsc-client';

describe('extractPagePerformance', () => {
  it('pulls url, impressions, clicks, and ctr out of a Search Console query response', () => {
    const response = {
      rows: [
        { keys: ['https://example.com/a'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 },
        { keys: ['https://example.com/b'], clicks: 0, impressions: 12, ctr: 0, position: 9.1 },
      ],
    };
    expect(extractPagePerformance(response)).toEqual([
      { url: 'https://example.com/a', impressions: 40, clicks: 3, ctr: 0.075 },
      { url: 'https://example.com/b', impressions: 12, clicks: 0, ctr: 0 },
    ]);
  });

  it('defaults missing metric fields to 0 and returns an empty array when there are no rows', () => {
    expect(extractPagePerformance({ rows: [{ keys: ['https://example.com/c'] }] })).toEqual([
      { url: 'https://example.com/c', impressions: 0, clicks: 0, ctr: 0 },
    ]);
    expect(extractPagePerformance({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gsc-client.test.ts`
Expected: FAIL — `extractPagePerformance` is not exported yet.

- [ ] **Step 3: Rewrite `src/lib/gsc-client.ts`**

```ts
import { google, searchconsole_v1 } from 'googleapis';
import { client } from './google-oauth';

type SearchAnalyticsResponse = searchconsole_v1.Schema$SearchAnalyticsQueryResponse;

export interface PagePerformance {
  url: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export function extractPagePerformance(response: SearchAnalyticsResponse): PagePerformance[] {
  return (response.rows ?? [])
    .filter((row) => Boolean(row.keys?.[0]))
    .map((row) => ({
      url: row.keys![0] as string,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      ctr: row.ctr ?? 0,
    }));
}

export function extractPageUrls(response: SearchAnalyticsResponse): string[] {
  return extractPagePerformance(response).map((page) => page.url);
}

const LOOKBACK_DAYS = 28;
const ROW_LIMIT = 100;

async function queryPagePerformance(refreshToken: string, siteUrl: string): Promise<SearchAnalyticsResponse> {
  const auth = client();
  auth.setCredentials({ refresh_token: refreshToken });

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const { data } = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      dimensions: ['page'],
      rowLimit: ROW_LIMIT,
    },
  });
  return data;
}

export async function listPagePerformance(refreshToken: string, siteUrl: string): Promise<PagePerformance[]> {
  return extractPagePerformance(await queryPagePerformance(refreshToken, siteUrl));
}

export async function listIndexedPages(refreshToken: string, siteUrl: string): Promise<string[]> {
  return (await listPagePerformance(refreshToken, siteUrl)).map((page) => page.url);
}

export async function listVerifiedSites(refreshToken: string): Promise<string[]> {
  const auth = client();
  auth.setCredentials({ refresh_token: refreshToken });

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const { data } = await searchconsole.sites.list();

  return (data.siteEntry ?? [])
    .filter((site) => site.permissionLevel && site.permissionLevel !== 'siteUnverifiedUser')
    .map((site) => site.siteUrl)
    .filter((url): url is string => Boolean(url));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/gsc-client.test.ts`
Expected: PASS (4 tests — the 2 existing `extractPageUrls` tests plus the 2 new `extractPagePerformance` tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/gsc-client.ts src/lib/gsc-client.test.ts
git commit -m "feat: add page-performance metrics (impressions/clicks/ctr) to GSC client"
```

---

### Task 3: Growth Brain — Flagging Logic

**Files:**
- Create: `src/lib/growth-brain.ts`
- Test: `src/lib/growth-brain.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (pure function over plain data) — but its input shape `PageSnapshot` is what Task 6 assembles from `PagePerformance` (Task 2) + `fetchPageMeta`'s result (Task 1).
- Produces: `interface PageSnapshot { url: string; title: string | null; metaDescription: string | null; h1: string | null; impressions: number; clicks: number; ctr: number }`, `interface FlaggedPage extends PageSnapshot { flagReason: string }`, `flagPages(pages: PageSnapshot[]): FlaggedPage[]` — used by Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/growth-brain.test.ts
import { describe, it, expect } from 'vitest';
import { flagPages, type PageSnapshot } from './growth-brain';

function page(overrides: Partial<PageSnapshot>): PageSnapshot {
  return {
    url: 'https://example.com/page',
    title: 'A Page',
    metaDescription: 'A perfectly fine meta description that sits comfortably within range.',
    h1: 'A Page',
    impressions: 10,
    clicks: 1,
    ctr: 0.1,
    ...overrides,
  };
}

describe('flagPages', () => {
  it('flags a page with no meta description', () => {
    const result = flagPages([page({ metaDescription: null })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('Missing meta description');
  });

  it('flags a page with a too-short meta description', () => {
    const result = flagPages([page({ metaDescription: 'Too short.' })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('too short');
  });

  it('flags a page with a too-long meta description', () => {
    const result = flagPages([page({ metaDescription: 'x'.repeat(200) })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('too long');
  });

  it('flags a page with high impressions and low CTR even if the meta description is well-formed', () => {
    const result = flagPages([page({ impressions: 500, ctr: 0.005 })]);
    expect(result).toHaveLength(1);
    expect(result[0].flagReason).toContain('low click-through rate');
  });

  it('does not flag a well-formed page with normal CTR', () => {
    const result = flagPages([page({})]);
    expect(result).toHaveLength(0);
  });

  it('does not flag a well-formed page with high impressions but healthy CTR', () => {
    const result = flagPages([page({ impressions: 500, ctr: 0.05 })]);
    expect(result).toHaveLength(0);
  });

  it('processes multiple pages independently', () => {
    const result = flagPages([page({ metaDescription: null, url: 'https://example.com/a' }), page({ url: 'https://example.com/b' })]);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/growth-brain.test.ts`
Expected: FAIL — `Cannot find module './growth-brain'`

- [ ] **Step 3: Write `src/lib/growth-brain.ts`**

```ts
export interface PageSnapshot {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface FlaggedPage extends PageSnapshot {
  flagReason: string;
}

const MIN_META_LENGTH = 50;
const MAX_META_LENGTH = 155;
// Starting thresholds for "worth a rewrite even though the meta description
// is technically fine" — a page Google shows often but users rarely click.
// Tune once real customer data exists (spec Section 9 open question).
const HIGH_IMPRESSION_THRESHOLD = 100;
const LOW_CTR_THRESHOLD = 0.02;

export function flagPages(pages: PageSnapshot[]): FlaggedPage[] {
  const flagged: FlaggedPage[] = [];

  for (const page of pages) {
    if (!page.metaDescription) {
      flagged.push({ ...page, flagReason: 'Missing meta description.' });
      continue;
    }

    const length = page.metaDescription.trim().length;

    if (length < MIN_META_LENGTH) {
      flagged.push({ ...page, flagReason: `Meta description is too short (${length} characters).` });
      continue;
    }

    if (length > MAX_META_LENGTH) {
      flagged.push({ ...page, flagReason: `Meta description is too long (${length} characters).` });
      continue;
    }

    if (page.impressions >= HIGH_IMPRESSION_THRESHOLD && page.ctr < LOW_CTR_THRESHOLD) {
      flagged.push({
        ...page,
        flagReason: `High impressions (${page.impressions}) with low click-through rate (${(page.ctr * 100).toFixed(1)}%) — the meta description may not be compelling enough.`,
      });
    }
  }

  return flagged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/growth-brain.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/growth-brain.ts src/lib/growth-brain.test.ts
git commit -m "feat: add Growth Brain flagging logic (missing/weak meta + high-impression/low-CTR)"
```

---

### Task 4: Creation Engine — OpenAI Draft Generation

**Files:**
- Modify: `package.json` (add `openai` dependency)
- Create: `src/lib/creation-engine.ts`
- Test: `src/lib/creation-engine.test.ts`

**Interfaces:**
- Produces: `interface PageContentForDraft { url: string; title: string | null; metaDescription: string | null; h1: string | null }`, `interface DraftResult { draftContent: string; tokenCost: number }`, `draftMetaDescription(page: PageContentForDraft, callOpenAI?: (prompt: string) => Promise<{ content: string; totalTokens: number }>): Promise<DraftResult>` — used by Task 6. The `callOpenAI` parameter is injectable so tests never make a real API call; the default implementation is the only place that touches the real OpenAI SDK.

- [ ] **Step 1: Add the `openai` dependency**

In `package.json`, add to `dependencies` (alphabetical, between `next` and `react` per the existing list's ordering... actually just add it next to `googleapis`):

```json
    "googleapis": "^140.0.0",
    "next": "^14.2.4",
    "openai": "^4.68.0",
    "react": "^18.3.1",
```

Run: `npm install`
Expected: `openai` added to `node_modules` and `package-lock.json`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/creation-engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { draftMetaDescription, type PageContentForDraft } from './creation-engine';

const page: PageContentForDraft = {
  url: 'https://example.com/widgets',
  title: 'Blue Widgets — Acme Co',
  metaDescription: null,
  h1: 'Blue Widgets',
};

describe('draftMetaDescription', () => {
  it('sends the page content to the injected caller and returns its draft plus token cost', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({
      content: 'Shop blue widgets from Acme Co, built to last and ready to ship today.',
      totalTokens: 87,
    });

    const result = await draftMetaDescription(page, callOpenAI);

    expect(result).toEqual({
      draftContent: 'Shop blue widgets from Acme Co, built to last and ready to ship today.',
      tokenCost: 87,
    });

    const promptSent = callOpenAI.mock.calls[0][0] as string;
    expect(promptSent).toContain('https://example.com/widgets');
    expect(promptSent).toContain('Blue Widgets — Acme Co');
    expect(promptSent).toContain('Blue Widgets');
    expect(promptSent).toContain('ONLY');
  });

  it('throws if the model returns an empty draft', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '', totalTokens: 12 });

    await expect(draftMetaDescription(page, callOpenAI)).rejects.toThrow('empty draft');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/creation-engine.test.ts`
Expected: FAIL — `Cannot find module './creation-engine'`

- [ ] **Step 4: Write `src/lib/creation-engine.ts`**

```ts
import OpenAI from 'openai';

export interface PageContentForDraft {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
}

export interface DraftResult {
  draftContent: string;
  tokenCost: number;
}

type OpenAICaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = 'gpt-4o-mini';

function buildPrompt(page: PageContentForDraft): string {
  return [
    "You write SEO meta descriptions for a customer's website.",
    'Rules:',
    '- Base the description ONLY on the page content given below. Never invent facts, numbers, or claims not present in it.',
    '- Length: 120-155 characters.',
    '- Sound like a person wrote it, not keyword-stuffed.',
    '- Output ONLY the meta description text. No quotes, no preamble, no explanation.',
    '',
    `Page URL: ${page.url}`,
    `Page title: ${page.title ?? '(none found)'}`,
    `Current meta description: ${page.metaDescription ?? '(none found)'}`,
    `Main heading (H1): ${page.h1 ?? '(none found)'}`,
  ].join('\n');
}

async function defaultCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function draftMetaDescription(
  page: PageContentForDraft,
  callOpenAI: OpenAICaller = defaultCaller
): Promise<DraftResult> {
  const prompt = buildPrompt(page);
  const { content, totalTokens } = await callOpenAI(prompt);
  if (!content) {
    throw new Error(`OpenAI returned an empty draft for ${page.url}`);
  }
  return { draftContent: content, tokenCost: totalTokens };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/creation-engine.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/creation-engine.ts src/lib/creation-engine.test.ts
git commit -m "feat: add Creation Engine (OpenAI meta-description drafting, grounded prompt)"
```

---

### Task 5: GrowthGuard-lite — The Five-Check Checklist

**Files:**
- Create: `src/lib/growth-guard.ts`
- Test: `src/lib/growth-guard.test.ts`

**Interfaces:**
- Produces: `type GuardOutcome = 'pass' | 'flag' | 'block'`, `interface GuardCheckResult { check: string; result: 'pass' | 'fail'; detail: string }`, `interface GrowthGuardInput { draftContent: string; sourceContent: { title: string | null; metaDescription: string | null }; aiDisclosure: boolean; recentDraftsForCustomer: string[] }`, `interface GrowthGuardResult { outcome: GuardOutcome; checksRun: GuardCheckResult[]; reasoning: string }`, `runGrowthGuard(input: GrowthGuardInput): GrowthGuardResult` — used by Task 6. Pure and synchronous: the caller is responsible for fetching `recentDraftsForCustomer` from the database before calling this function (see Task 6) — this module never touches Prisma or the network, matching ADR 0004's "hardcoded checklist, not a model" and eval-criteria.md's framing of GrowthGuard as small pure logic to test exhaustively.

- [ ] **Step 1: Write the failing test — covers all 5 checks, one bad input and one clean input each, per `docs/eval-criteria.md` Section 2's exact test matrix**

```ts
// src/lib/growth-guard.test.ts
import { describe, it, expect } from 'vitest';
import { runGrowthGuard, type GrowthGuardInput } from './growth-guard';

function baseInput(overrides: Partial<GrowthGuardInput> = {}): GrowthGuardInput {
  return {
    draftContent: 'Shop our range of blue widgets, built to last and ready to ship today.',
    sourceContent: { title: 'Blue Widgets', metaDescription: null },
    aiDisclosure: true,
    recentDraftsForCustomer: [],
    ...overrides,
  };
}

describe('runGrowthGuard', () => {
  describe('AI-content disclosure', () => {
    it('blocks when the disclosure flag is missing', () => {
      const result = runGrowthGuard(baseInput({ aiDisclosure: false }));
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'ai-content-disclosure')?.result).toBe('fail');
    });

    it('passes when the disclosure flag is attached', () => {
      const result = runGrowthGuard(baseInput({ aiDisclosure: true }));
      expect(result.checksRun.find((c) => c.check === 'ai-content-disclosure')?.result).toBe('pass');
    });
  });

  describe('no unverifiable factual claims', () => {
    it('blocks a draft with a "#1" claim not present in the source', () => {
      const result = runGrowthGuard(
        baseInput({ draftContent: 'The #1 rated blue widgets on the market today.' })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });

    it('blocks a draft with an invented percentage not present in the source', () => {
      const result = runGrowthGuard(baseInput({ draftContent: 'Widgets rated 43% faster than the rest.' }));
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('fail');
    });

    it('passes a draft with no invented numbers or superlatives', () => {
      const result = runGrowthGuard(baseInput({ draftContent: 'Shop our range of blue widgets, in stock now.' }));
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('pass');
    });

    it('passes a claim that IS present in the source content', () => {
      const result = runGrowthGuard(
        baseInput({
          draftContent: 'The #1 choice for blue widgets.',
          sourceContent: { title: 'The #1 choice for blue widgets', metaDescription: null },
        })
      );
      expect(result.checksRun.find((c) => c.check === 'no-unverifiable-claims')?.result).toBe('pass');
    });
  });

  describe('no contradiction of source content', () => {
    it('blocks a draft claiming "in stock" when the source says out of stock', () => {
      const result = runGrowthGuard(
        baseInput({
          draftContent: 'Blue widgets, in stock and ready to ship.',
          sourceContent: { title: 'Blue Widgets', metaDescription: 'Currently out of stock.' },
        })
      );
      expect(result.outcome).toBe('block');
      expect(result.checksRun.find((c) => c.check === 'no-contradiction')?.result).toBe('fail');
    });

    it('passes a draft that only restates what is actually on the page', () => {
      const result = runGrowthGuard(
        baseInput({
          draftContent: 'Blue widgets, currently out of stock — check back soon.',
          sourceContent: { title: 'Blue Widgets', metaDescription: 'Currently out of stock.' },
        })
      );
      expect(result.checksRun.find((c) => c.check === 'no-contradiction')?.result).toBe('pass');
    });
  });

  describe('length/format validity', () => {
    it('flags a draft over 155 characters', () => {
      const result = runGrowthGuard(baseInput({ draftContent: 'x'.repeat(200) }));
      expect(result.outcome).toBe('flag');
      expect(result.checksRun.find((c) => c.check === 'length-format')?.result).toBe('fail');
    });

    it('passes a draft within range', () => {
      const result = runGrowthGuard(baseInput({ draftContent: 'A reasonably sized meta description.' }));
      expect(result.checksRun.find((c) => c.check === 'length-format')?.result).toBe('pass');
    });
  });

  describe('duplicate-risk', () => {
    it('flags a near-duplicate of another recent draft for the same customer', () => {
      const result = runGrowthGuard(
        baseInput({
          draftContent: 'Shop our range of blue widgets, built to last and ready to ship today.',
          recentDraftsForCustomer: ['Shop our range of blue widgets, built to last and ready to ship this week.'],
        })
      );
      expect(result.outcome).toBe('flag');
      expect(result.checksRun.find((c) => c.check === 'duplicate-risk')?.result).toBe('fail');
    });

    it('passes two drafts with genuinely distinct content', () => {
      const result = runGrowthGuard(
        baseInput({
          draftContent: 'Shop our range of blue widgets, built to last and ready to ship today.',
          recentDraftsForCustomer: ['Browse our catalog of premium red gadgets, handcrafted in small batches.'],
        })
      );
      expect(result.checksRun.find((c) => c.check === 'duplicate-risk')?.result).toBe('pass');
    });
  });

  describe('outcome aggregation', () => {
    it('returns pass with all-pass reasoning when every check passes', () => {
      const result = runGrowthGuard(baseInput());
      expect(result.outcome).toBe('pass');
      expect(result.reasoning).toBe('All checks passed.');
      expect(result.checksRun).toHaveLength(5);
    });

    it('prioritizes block over flag when both a hard-fail and a soft-fail are present', () => {
      const result = runGrowthGuard(baseInput({ aiDisclosure: false, draftContent: 'x'.repeat(200) }));
      expect(result.outcome).toBe('block');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/growth-guard.test.ts`
Expected: FAIL — `Cannot find module './growth-guard'`

- [ ] **Step 3: Write `src/lib/growth-guard.ts`**

```ts
export type GuardOutcome = 'pass' | 'flag' | 'block';

export interface GuardCheckResult {
  check: string;
  result: 'pass' | 'fail';
  detail: string;
}

export interface GrowthGuardInput {
  draftContent: string;
  sourceContent: { title: string | null; metaDescription: string | null };
  aiDisclosure: boolean;
  recentDraftsForCustomer: string[];
}

export interface GrowthGuardResult {
  outcome: GuardOutcome;
  checksRun: GuardCheckResult[];
  reasoning: string;
}

const MAX_LENGTH = 155;
const CLAIM_PATTERNS: RegExp[] = [
  /#1\b/i,
  /\bbest\b/i,
  /\bfastest\b/i,
  /\bcheapest\b/i,
  /\btop[- ]rated\b/i,
  /\bleading\b/i,
  /\d+%/,
];
const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;
const HARD_FAIL_CHECKS = new Set(['ai-content-disclosure', 'no-unverifiable-claims', 'no-contradiction']);

function sourceText(source: { title: string | null; metaDescription: string | null }): string {
  return `${source.title ?? ''} ${source.metaDescription ?? ''}`.toLowerCase();
}

function checkDisclosure(aiDisclosure: boolean): GuardCheckResult {
  return aiDisclosure
    ? { check: 'ai-content-disclosure', result: 'pass', detail: 'Disclosure flag attached.' }
    : { check: 'ai-content-disclosure', result: 'fail', detail: 'AI-content disclosure flag is missing.' };
}

function checkUnverifiableClaims(
  draftContent: string,
  source: { title: string | null; metaDescription: string | null }
): GuardCheckResult {
  const haystack = sourceText(source);
  for (const pattern of CLAIM_PATTERNS) {
    const match = draftContent.match(pattern);
    if (match && !haystack.includes(match[0].toLowerCase())) {
      return {
        check: 'no-unverifiable-claims',
        result: 'fail',
        detail: `Draft contains "${match[0]}", which does not appear in the source page content.`,
      };
    }
  }
  return { check: 'no-unverifiable-claims', result: 'pass', detail: 'No unverifiable numeric or superlative claims found.' };
}

function checkContradiction(
  draftContent: string,
  source: { title: string | null; metaDescription: string | null }
): GuardCheckResult {
  const haystack = sourceText(source);
  const draftLower = draftContent.toLowerCase();
  if (haystack.includes('out of stock') && draftLower.includes('in stock')) {
    return {
      check: 'no-contradiction',
      result: 'fail',
      detail: 'Draft claims the product is in stock, but the source page says it is out of stock.',
    };
  }
  return { check: 'no-contradiction', result: 'pass', detail: 'Draft does not contradict the source page content.' };
}

function checkLength(draftContent: string): GuardCheckResult {
  const length = draftContent.trim().length;
  return length > MAX_LENGTH
    ? { check: 'length-format', result: 'fail', detail: `Draft is ${length} characters, over the ${MAX_LENGTH}-character guidance.` }
    : { check: 'length-format', result: 'pass', detail: `Draft is ${length} characters, within range.` };
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

function checkDuplicateRisk(draftContent: string, recentDraftsForCustomer: string[]): GuardCheckResult {
  for (const existing of recentDraftsForCustomer) {
    if (jaccardSimilarity(draftContent, existing) >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return {
        check: 'duplicate-risk',
        result: 'fail',
        detail: 'Draft is a near-duplicate of another recent draft for this customer.',
      };
    }
  }
  return { check: 'duplicate-risk', result: 'pass', detail: 'No near-duplicate found among recent drafts for this customer.' };
}

export function runGrowthGuard(input: GrowthGuardInput): GrowthGuardResult {
  const checksRun: GuardCheckResult[] = [
    checkDisclosure(input.aiDisclosure),
    checkUnverifiableClaims(input.draftContent, input.sourceContent),
    checkContradiction(input.draftContent, input.sourceContent),
    checkLength(input.draftContent),
    checkDuplicateRisk(input.draftContent, input.recentDraftsForCustomer),
  ];

  const failedChecks = checksRun.filter((c) => c.result === 'fail');
  const hardFail = failedChecks.find((c) => HARD_FAIL_CHECKS.has(c.check));

  if (hardFail) {
    return { outcome: 'block', checksRun, reasoning: failedChecks.map((c) => c.detail).join(' ') };
  }
  if (failedChecks.length > 0) {
    return { outcome: 'flag', checksRun, reasoning: failedChecks.map((c) => c.detail).join(' ') };
  }
  return { outcome: 'pass', checksRun, reasoning: 'All checks passed.' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/growth-guard.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/growth-guard.ts src/lib/growth-guard.test.ts
git commit -m "feat: add GrowthGuard-lite checklist (5 hardcoded checks per ADR 0004)"
```

---

### Task 6: Wire the Pipeline into `/api/scan`

**Files:**
- Modify: `src/app/api/scan/route.ts`

**Interfaces:**
- Consumes: `listPagePerformance` (Task 2), `fetchPageMeta` (Task 1), `flagPages`/`PageSnapshot` (Task 3), `draftMetaDescription` (Task 4), `runGrowthGuard` (Task 5), plus existing `db`, `decrypt` from Week 1.
- Produces: the final Week 2 deliverable — `POST /api/scan` now creates real `Action` + `GuardResult` rows, not just a page listing.

- [ ] **Step 1: Rewrite `src/app/api/scan/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { listPagePerformance } from '@/lib/gsc-client';
import { fetchPageMeta } from '@/lib/crawler';
import { flagPages, type PageSnapshot } from '@/lib/growth-brain';
import { draftMetaDescription } from '@/lib/creation-engine';
import { runGrowthGuard } from '@/lib/growth-guard';

export const maxDuration = 60; // Vercel function timeout ceiling on paid plans; Hobby caps at 10s regardless

const MAX_PAGES_PER_SCAN = 20;
const MAX_DRAFTS_PER_SCAN = 10; // bounds OpenAI cost/latency separately from the crawl cap above
const RECENT_DRAFTS_LIMIT = 50;

export async function POST() {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer?.gscRefreshToken) {
    return NextResponse.json({ error: 'Connect Google Search Console first' }, { status: 400 });
  }

  try {
    const refreshToken = decrypt(customer.gscRefreshToken);
    const performance = (await listPagePerformance(refreshToken, customer.websiteUrl)).slice(0, MAX_PAGES_PER_SCAN);

    const snapshots: PageSnapshot[] = [];
    for (const page of performance) {
      const meta = await fetchPageMeta(page.url);
      snapshots.push({ ...page, ...meta });
    }

    const flagged = flagPages(snapshots).slice(0, MAX_DRAFTS_PER_SCAN);

    const recentActions = await db.action.findMany({
      where: { customerId: customer.id, actionType: 'meta_description' },
      orderBy: { createdAt: 'desc' },
      take: RECENT_DRAFTS_LIMIT,
      select: { draftContent: true },
    });
    const recentDraftsForCustomer = recentActions.map((a) => a.draftContent);

    let draftsCreated = 0;
    for (const page of flagged) {
      const alreadyPending = await db.action.findFirst({
        where: { customerId: customer.id, pageUrl: page.url, status: 'pending' },
      });
      if (alreadyPending) continue;

      const { draftContent, tokenCost } = await draftMetaDescription({
        url: page.url,
        title: page.title,
        metaDescription: page.metaDescription,
        h1: page.h1,
      });

      const guardResult = runGrowthGuard({
        draftContent,
        sourceContent: { title: page.title, metaDescription: page.metaDescription },
        aiDisclosure: true,
        recentDraftsForCustomer,
      });

      const status = guardResult.outcome === 'pass' && customer.autoExecuteEnabled ? 'approved' : 'pending';

      await db.action.create({
        data: {
          customerId: customer.id,
          pageUrl: page.url,
          actionType: 'meta_description',
          currentValue: page.metaDescription,
          draftContent,
          aiDisclosure: true,
          status,
          tokenCost,
          guardResult: {
            create: {
              outcome: guardResult.outcome,
              checksRun: guardResult.checksRun,
              reasoning: guardResult.reasoning,
            },
          },
        },
      });

      recentDraftsForCustomer.push(draftContent);
      draftsCreated += 1;
    }

    return NextResponse.json({
      pagesScanned: snapshots.length,
      pagesFlagged: flagged.length,
      draftsCreated,
      pages: snapshots,
    });
  } catch {
    return NextResponse.json({ error: 'Scan failed. Check that the connected Search Console property is correct.' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: `✓ Compiled successfully`, `/api/scan` still registered as a route.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (Week 1's suite plus Tasks 1-5's new tests, no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/scan/route.ts
git commit -m "feat: wire Growth Brain + Creation Engine + GrowthGuard into /api/scan, completing Week 2 pipeline"
```
