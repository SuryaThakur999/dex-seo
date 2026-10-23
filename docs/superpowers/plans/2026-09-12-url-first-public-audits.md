# URL-First Public Audits (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in customer can enter any public URL and run an audit that produces evidence-backed findings without ever connecting Google Search Console. GSC becomes a fully optional enrichment layer, never a prerequisite.

**Architecture:** Split "the URL being audited" (`Website.url`, always real) from "the optional verified Search Console property" (new `Website.gscPropertyUrl`, nullable). Give the scan pipeline a Google-free page-discovery path (homepage crawl + sitemap + internal links) alongside its existing GSC-performance path, selected automatically by which fields are populated. Remove the hard block in `/api/scan` that currently requires a GSC token to run at all.

**Tech Stack:** Next.js App Router route handlers, Prisma/Postgres (Neon), Vitest, cheerio (already a dependency, used for HTML parsing).

## Global Constraints

- Every task must run the full suite (`npx vitest run`) and `tsc --noEmit` before being considered done — zero tolerance for a regression in an unrelated file.
- Read `DATABASE_URL` for `tsc`/build-adjacent commands inline from `.env.local`: `DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')` — never print its value, never use it beyond that one local command.
- Schema migrations are generated and applied against the isolated dev branch `.env.milestone-b-dev` only: `set -a; source .env.milestone-b-dev; set +a; npx prisma migrate dev ...`. Never run `prisma migrate dev` against `.env.local` (production). Production gets the migration only via `prisma migrate deploy`, run by the plan's controller at actual deploy time — not by any task implementer.
- Never call Google's live API from a test. Every Google-touching test mocks `@/lib/gsc-client`.
- Tasks are NOT independent in the strict SDD sense: Task 6 depends on Task 2's `fetchHtml`/`extractInternalLinks` and Task 1's `gscPropertyUrl` field. Tasks 3, 4, 5, 7 all depend on Task 1's schema field. Execute in the numbered order 1 → 8; do not parallelize.
- `PENDING_WEBSITE_URL` (`'https://example-pending-setup.com'`, exported from `src/lib/customer.ts`) keeps existing going forward only as a **legacy marker** meaning "this row's crawl URL was never confirmed" — it stops being written by any code path as of Task 5, and stops meaning "no GSC property selected" as of Task 3/4.

---

### Task 1: Schema — add `gscPropertyUrl`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_gsc_property_url/migration.sql` (generated, not hand-written)

**Interfaces:**
- Produces: `Website.gscPropertyUrl: string | null` on the Prisma Client type, consumed by Tasks 3, 4, 6.

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, in the `Website` model, add this line immediately after the existing `gscRefreshToken String?` line:

```prisma
  // The verified Search Console property, once selected — independent of `url`,
  // which is always the crawl target.
  gscPropertyUrl     String?
```

- [ ] **Step 2: Generate and apply the migration against the isolated dev branch**

```bash
cd /Users/surya/Projects/dex-ai
set -a; source .env.milestone-b-dev; set +a
npx prisma migrate dev --name add_gsc_property_url --skip-seed
```

Expected: a new folder under `prisma/migrations/` containing a single `migration.sql` with exactly:

```sql
-- AlterTable
ALTER TABLE "Website" ADD COLUMN     "gscPropertyUrl" TEXT;
```

Nullable, no default — `NULL` is the correct "not yet selected" state (unlike the boolean `gscReconnectRequired`, this field needs no default value).

- [ ] **Step 3: Confirm the Prisma Client regenerated**

The `migrate dev` command runs `prisma generate` automatically. Confirm with:

```bash
grep -n "gscPropertyUrl" node_modules/.prisma/client/index.d.ts | head -3
```

Expected: at least one match showing the field on the `Website` type.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Website.gscPropertyUrl, independent of the crawl url"
```

---

### Task 2: `crawler.ts` — extract `fetchHtml`, add `extractInternalLinks`

**Files:**
- Modify: `src/lib/crawler.ts`
- Test: `src/lib/crawler.test.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing `cheerio`, `isAllowedByRobots`, `throttle` already in this file).
- Produces: `fetchHtml(url: string, fetchImpl?: typeof fetch): Promise<string | null>` and `extractInternalLinks(html: string, baseUrl: string): string[]`, both consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/crawler.test.ts`, after the existing `fetchPageMeta` describe block:

```typescript
describe('fetchHtml', () => {
  it('does not fetch the page and returns null when robots.txt disallows it', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      throw new Error('should not fetch a disallowed page');
    });

    const result = await fetchHtml('https://blocked-html.example.com/blocked/page', fetchImpl as unknown as typeof fetch);

    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches and returns the raw HTML for a page robots.txt allows', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      return { ok: true, text: async () => '<html><body>hello</body></html>' } as Response;
    });

    const result = await fetchHtml('https://allowed-html.example.com/page', fetchImpl as unknown as typeof fetch);

    expect(result).toBe('<html><body>hello</body></html>');
  });
});

describe('extractInternalLinks', () => {
  it('extracts absolute and relative same-hostname links, resolving relative ones against baseUrl', () => {
    const html = `
      <html><body>
        <a href="/about">About</a>
        <a href="https://example.com/contact">Contact</a>
        <a href="pricing">Pricing</a>
      </body></html>
    `;
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links.sort()).toEqual([
      'https://example.com/about',
      'https://example.com/contact',
      'https://example.com/pricing',
    ]);
  });

  it('excludes a link to a different hostname', () => {
    const html = '<a href="https://other-site.com/page">External</a><a href="/local">Local</a>';
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links).toEqual(['https://example.com/local']);
  });

  it('excludes mailto, javascript, and tel hrefs', () => {
    const html = `
      <a href="mailto:hi@example.com">Email</a>
      <a href="javascript:void(0)">JS</a>
      <a href="tel:+15551234567">Call</a>
      <a href="/real-page">Real</a>
    `;
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links).toEqual(['https://example.com/real-page']);
  });

  it('dedupes the same page reached via different hash fragments', () => {
    const html = '<a href="/page#section-a">A</a><a href="/page#section-b">B</a>';
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links).toEqual(['https://example.com/page']);
  });

  it('returns an empty array for HTML with no anchor tags', () => {
    const links = extractInternalLinks('<html><body><p>No links here.</p></body></html>', 'https://example.com/');
    expect(links).toEqual([]);
  });
});
```

Update the import line at the top of `crawler.test.ts` from:
```typescript
import { isAllowedByRobots, parsePageMeta, throttle, fetchPageMeta } from './crawler';
```
to:
```typescript
import { isAllowedByRobots, parsePageMeta, throttle, fetchPageMeta, fetchHtml, extractInternalLinks } from './crawler';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/crawler.test.ts
```

Expected: FAIL — `fetchHtml` and `extractInternalLinks` are not exported yet.

- [ ] **Step 3: Refactor `fetchPageMeta` to extract `fetchHtml`, and add `extractInternalLinks`**

In `src/lib/crawler.ts`, replace the existing `fetchPageMeta` function:

```typescript
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
    // A single page's network failure must not abort Task 8's scan loop
    // over the rest of a customer's pages.
    return { title: null, metaDescription: null, h1: null };
  }
}
```

with this (`fetchHtml` extracted, `fetchPageMeta` now built on it, plus the new `extractInternalLinks`):

```typescript
export async function fetchHtml(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const { hostname } = new URL(url);

  const allowed = await isAllowedByRobots(url, (robotsUrl) => cachedFetchRobotsTxt(robotsUrl, fetchImpl));
  if (!allowed) return null;

  await throttle(hostname, 1000);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    // A single page's network failure must not abort the scan loop over
    // the rest of a customer's pages.
    return null;
  }
}

export async function fetchPageMeta(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ title: string | null; metaDescription: string | null; h1: string | null }> {
  const html = await fetchHtml(url, fetchImpl);
  if (html === null) return { title: null, metaDescription: null, h1: null };
  return parsePageMeta(html);
}

// Same-hostname links reachable from one page's HTML — the no-GSC page-discovery
// source (alongside sitemap.xml) for a site with no Search Console connection.
export function extractInternalLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) return;
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
      resolved.hash = '';
      links.add(resolved.toString());
    } catch {
      // malformed or unparseable href (mailto:, javascript:, tel:, etc.) — skip
    }
  });
  return [...links];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/crawler.test.ts
```

Expected: PASS, all tests including the pre-existing `fetchPageMeta`/`parsePageMeta`/`isAllowedByRobots`/`throttle` ones (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crawler.ts src/lib/crawler.test.ts
git commit -m "feat: extract fetchHtml from fetchPageMeta, add extractInternalLinks"
```

---

### Task 3: `gsc-connection-state.ts` — redefine on `gscPropertyUrl`

**Files:**
- Modify: `src/lib/gsc-connection-state.ts`
- Test: `src/lib/gsc-connection-state.test.ts`

**Interfaces:**
- Consumes: `Website.gscPropertyUrl` (Task 1).
- Produces: `computeGscConnectionState(site: { gscRefreshToken: string | null; gscReconnectRequired: boolean; gscPropertyUrl: string | null }): GscConnectionState` — same four-value return type as before, new input shape (no `url` field).

- [ ] **Step 1: Update the failing tests**

Replace the full contents of `src/lib/gsc-connection-state.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { computeGscConnectionState } from './gsc-connection-state';

describe('computeGscConnectionState', () => {
  it('is not_connected when no token is stored', () => {
    const state = computeGscConnectionState({ gscRefreshToken: null, gscReconnectRequired: false, gscPropertyUrl: null });
    expect(state).toBe('not_connected');
  });

  it('is property_pending when a token is stored but no property has been selected yet', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'token',
      gscReconnectRequired: false,
      gscPropertyUrl: null,
    });
    expect(state).toBe('property_pending');
  });

  it('is reconnect_required when Google has flagged the stored token dead, even mid property-selection', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'dead-token',
      gscReconnectRequired: true,
      gscPropertyUrl: null,
    });
    expect(state).toBe('reconnect_required');
  });

  it('is connected when a token is stored, not flagged, and a real property is selected', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'token',
      gscReconnectRequired: false,
      gscPropertyUrl: 'https://acme.com',
    });
    expect(state).toBe('connected');
  });

  it('is reconnect_required, not connected, when a flagged token happens to have a resolved property', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'dead-token',
      gscReconnectRequired: true,
      gscPropertyUrl: 'https://acme.com',
    });
    expect(state).toBe('reconnect_required');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/gsc-connection-state.test.ts
```

Expected: FAIL — the current implementation's `computeGscConnectionState` still expects a `url` field, and TypeScript will also flag the input shape mismatch.

- [ ] **Step 3: Implement**

Replace the full contents of `src/lib/gsc-connection-state.ts` with:

```typescript
export type GscConnectionState = 'not_connected' | 'reconnect_required' | 'property_pending' | 'connected';

/**
 * Classifies a site's Search Console connection from already-stored fields
 * only — no live Google call. Order matters: a dead token (reconnectRequired)
 * takes priority over a pending property selection, since selecting a
 * property against a dead token would just fail again.
 */
export function computeGscConnectionState(site: {
  gscRefreshToken: string | null;
  gscReconnectRequired: boolean;
  gscPropertyUrl: string | null;
}): GscConnectionState {
  if (!site.gscRefreshToken) return 'not_connected';
  if (site.gscReconnectRequired) return 'reconnect_required';
  if (!site.gscPropertyUrl) return 'property_pending';
  return 'connected';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/gsc-connection-state.test.ts
```

Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gsc-connection-state.ts src/lib/gsc-connection-state.test.ts
git commit -m "refactor: key computeGscConnectionState on gscPropertyUrl instead of url"
```

---

### Task 4: `select-site/route.ts` — write to `gscPropertyUrl`, not `url`

**Files:**
- Modify: `src/app/api/gsc/select-site/route.ts`
- Test: `src/app/api/gsc/select-site/route.test.ts`

**Interfaces:**
- Consumes: `Website.gscPropertyUrl` (Task 1).
- Produces: no change to this route's HTTP contract (still POST, still redirects to `/settings` on success) — only the DB write's `data` shape changes.

- [ ] **Step 1: Update the two success-path tests**

In `src/app/api/gsc/select-site/route.test.ts`, change the assertion in `'updates the website named by an explicit websiteId field, not the default'`:

```typescript
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w2' },
      data: { gscPropertyUrl: 'https://acme.com', gscReconnectRequired: false },
    });
```

And in `'falls back to the default website when websiteId is absent'`:

```typescript
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { gscPropertyUrl: 'https://acme.com', gscReconnectRequired: false },
    });
```

(Both previously asserted `{ url: 'https://acme.com', normalizedHost: 'acme.com', gscReconnectRequired: false }` — replace exactly that `data` object in each.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/gsc/select-site/route.test.ts
```

Expected: FAIL on those two tests — the route still writes the old shape.

- [ ] **Step 3: Implement**

In `src/app/api/gsc/select-site/route.ts`, remove this import line entirely:
```typescript
import { normalizeSiteUrl } from '@/lib/entitlements';
```

Change the final success-path write from:
```typescript
  try {
    await db.website.update({
      where: { id: website.id },
      data: { url: siteUrl, normalizedHost: normalizeSiteUrl(siteUrl), gscReconnectRequired: false },
    });
  } catch (err) {
```
to:
```typescript
  try {
    await db.website.update({
      where: { id: website.id },
      data: { gscPropertyUrl: siteUrl, gscReconnectRequired: false },
    });
  } catch (err) {
```

Every other branch in this file (decrypt failure, `GoogleAuthError`, `GoogleConfigError`, verified-sites mismatch) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/api/gsc/select-site/route.test.ts
```

Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gsc/select-site/route.ts src/app/api/gsc/select-site/route.test.ts
git commit -m "fix: select-site writes the verified property to gscPropertyUrl, never to url"
```

---

### Task 5: `websites/route.ts` — stop reparenting `url` on inheritance

**Files:**
- Modify: `src/app/api/websites/route.ts`
- Test: `src/app/api/websites/route.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `POST /api/websites`'s response body no longer ever returns `PENDING_WEBSITE_URL` as `url` — always the customer's typed URL.

- [ ] **Step 1: Update the tests**

In `src/app/api/websites/route.test.ts`, change the test `'inherits a sibling website\'s GSC token onto the new website'` to:

```typescript
  it('inherits a sibling website\'s GSC token onto the new website, without touching its own url', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: 'encrypted-token' }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w2',
      url: 'https://newsite.com',
    });

    const res = await POST(makeRequest('https://newsite.com'));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: 'w2', url: 'https://newsite.com', gscInherited: true });
    // Inherits Google auth only — the crawl url stays exactly what the customer
    // typed, immediately auditable without any property selection.
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w2' },
      data: { gscRefreshToken: 'encrypted-token' },
    });
    expect(createWebsiteWithEntitlementCheck).toHaveBeenCalledWith({
      clientProfileId: 'profile_1',
      url: 'https://newsite.com',
    });
  });
```

Replace the test `'lets a second website inherit a token without colliding on the first pending host'` (obsolete — two inherited-token sites can no longer collide on a shared sentinel host, since neither one's `url` is ever touched) with:

```typescript
  it('lets any number of sibling sites independently inherit the same token', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [
        { id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: 'encrypted-token' },
        { id: 'w2', clientProfileId: 'profile_1', url: 'https://newsite.com', normalizedHost: 'newsite.com', gscRefreshToken: 'encrypted-token' },
      ],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w3',
      url: 'https://thirdsite.com',
    });

    const res = await POST(makeRequest('https://thirdsite.com'));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: 'w3', url: 'https://thirdsite.com', gscInherited: true });
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w3' },
      data: { gscRefreshToken: 'encrypted-token' },
    });
  });
```

Remove the now-unused `PENDING_WEBSITE_URL` import: change
```typescript
import { resolveWebsiteForRequest, PENDING_WEBSITE_URL } from '@/lib/customer';
```
to
```typescript
import { resolveWebsiteForRequest } from '@/lib/customer';
```
and remove `PENDING_WEBSITE_URL: 'https://example-pending-setup.com',` from the `vi.mock('@/lib/customer', ...)` factory at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/websites/route.test.ts
```

Expected: FAIL on the two rewritten tests — the route still reparents `url` to the sentinel.

- [ ] **Step 3: Implement**

In `src/app/api/websites/route.ts`, change the import line from:
```typescript
import { resolveWebsiteForRequest, PENDING_WEBSITE_URL } from '@/lib/customer';
```
to:
```typescript
import { resolveWebsiteForRequest } from '@/lib/customer';
```

Change the inheritance block and response from:
```typescript
    const siblingWithToken = websites.find((w) => w.gscRefreshToken && !w.gscReconnectRequired);
    const gscInherited = Boolean(siblingWithToken);
    if (siblingWithToken) {
      // An inherited token grants Search Console access but says nothing about
      // which verified property this site maps to, so park its `url` on the
      // pending sentinel — that's the signal /settings and the dashboard both
      // read to show the verified-property picker. `normalizedHost` keeps the
      // host the user actually typed: it is the duplicate-detection key, and
      // sharing the sentinel's host would make a second inherited-token site
      // collide with the first.
      await db.website.update({
        where: { id: created.id },
        data: { gscRefreshToken: siblingWithToken.gscRefreshToken, url: PENDING_WEBSITE_URL },
      });
    }

    return NextResponse.json(
      { id: created.id, url: gscInherited ? PENDING_WEBSITE_URL : created.url, gscInherited },
      { status: 201 }
    );
```
to:
```typescript
    const siblingWithToken = websites.find((w) => w.gscRefreshToken && !w.gscReconnectRequired);
    const gscInherited = Boolean(siblingWithToken);
    if (siblingWithToken) {
      // Inherits Google auth only — never touches `url`/`normalizedHost`, which stay
      // exactly what the customer typed and are immediately auditable without any
      // property selection.
      await db.website.update({
        where: { id: created.id },
        data: { gscRefreshToken: siblingWithToken.gscRefreshToken },
      });
    }

    return NextResponse.json({ id: created.id, url: created.url, gscInherited }, { status: 201 });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/api/websites/route.test.ts
```

Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/websites/route.ts src/app/api/websites/route.test.ts
git commit -m "fix: sibling GSC-token inheritance never overwrites the new site's crawl url"
```

---

### Task 6: `run-scan.ts` — GSC vs. public crawl-discovery branch, no hard block

**Files:**
- Modify: `src/lib/run-scan.ts`
- Test: `src/lib/run-scan.test.ts`

**Interfaces:**
- Consumes: `fetchHtml`, `extractInternalLinks` (Task 2); `Website.gscPropertyUrl` (Task 1).
- Produces: `runScanForCustomer` no longer throws when `website.gscRefreshToken` is null — it runs a public crawl instead. Its exported `ScanResult` return type is unchanged.

- [ ] **Step 1: Update the existing GSC-path tests and write the new no-GSC tests**

In `src/lib/run-scan.test.ts`, add `gscPropertyUrl: 'https://example.com'` to the existing `WEBSITE` constant so every current "sitemap quota" test keeps exercising the GSC path:

```typescript
const WEBSITE = {
  id: 'web_1',
  gscRefreshToken: 'encrypted',
  gscReconnectRequired: false,
  gscPropertyUrl: 'https://example.com',
  url: 'https://example.com',
  autoExecuteEnabled: false,
} as Website;
```

Update the `vi.mock('@/lib/gsc-client', ...)` factory to also export the real `GoogleAuthError` (it already does per prior work this session — confirm the line `GoogleAuthError: class GoogleAuthError extends Error {},` is present; if the mock factory instead does `importOriginal`-based spreading, leave as-is).

Change the `vi.mock('@/lib/crawler', ...)` factory from:
```typescript
vi.mock('@/lib/crawler', () => ({
  fetchPageMeta: vi.fn(),
}));
```
(or whatever its current shape is — check the file) to also provide `fetchHtml` as a mock and `extractInternalLinks` as the real implementation:
```typescript
vi.mock('@/lib/crawler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crawler')>();
  return { ...actual, fetchPageMeta: vi.fn(), fetchHtml: vi.fn() };
});
```

Add near the bottom of the file (after the existing `describe('runScanForCustomer — sitemap quota', ...)` block):

```typescript
describe('runScanForCustomer — without GSC', () => {
  const NO_GSC_WEBSITE = {
    id: 'web_1',
    gscRefreshToken: null,
    gscReconnectRequired: false,
    gscPropertyUrl: null,
    url: 'https://example.com',
    autoExecuteEnabled: false,
  } as Website;

  beforeEach(() => {
    vi.clearAllMocks();
    (fetchPageMeta as ReturnType<typeof vi.fn>).mockResolvedValue({ title: null, metaDescription: null, h1: null });
  });

  it('never calls listPagePerformance when there is no GSC token', async () => {
    (fetchHtml as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    expect(listPagePerformance).not.toHaveBeenCalled();
  });

  it('discovers pages from homepage internal links and the sitemap', async () => {
    (fetchHtml as ReturnType<typeof vi.fn>).mockResolvedValue(
      '<html><body><a href="/about">About</a><a href="https://example.com/contact">Contact</a></body></html>'
    );
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    const scannedUrls = (fetchPageMeta as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(scannedUrls).toContain('https://example.com');
    expect(scannedUrls).toContain('https://example.com/about');
    expect(scannedUrls).toContain('https://example.com/contact');
  });

  it('falls back to sitemap URLs plus the homepage itself when the homepage fetch fails', async () => {
    (fetchHtml as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue(['https://example.com/sitemap-page']);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    const scannedUrls = (fetchPageMeta as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(scannedUrls).toContain('https://example.com');
    expect(scannedUrls).toContain('https://example.com/sitemap-page');
  });

  it('caps page discovery at MAX_PAGES_PER_SCAN (20)', async () => {
    const manyLinks = Array.from({ length: 30 }, (_, i) => `<a href="/page-${i}">Page ${i}</a>`).join('');
    (fetchHtml as ReturnType<typeof vi.fn>).mockResolvedValue(`<html><body>${manyLinks}</body></html>`);
    (fetchSitemapUrls as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runScanForCustomer(CUSTOMER, NO_GSC_WEBSITE);

    expect((fetchPageMeta as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(20);
  });
});
```

Add `fetchHtml` to this test file's top-level import from `@/lib/gsc-client`... **no** — `fetchHtml` comes from `@/lib/crawler`, not `gsc-client`. Update the import line:
```typescript
import { fetchPageMeta } from '@/lib/crawler';
```
to:
```typescript
import { fetchPageMeta, fetchHtml } from '@/lib/crawler';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/run-scan.test.ts
```

Expected: FAIL — `runScanForCustomer` still throws immediately for a website with no `gscRefreshToken`, and `fetchHtml` isn't imported by the source file yet.

- [ ] **Step 3: Implement**

In `src/lib/run-scan.ts`, change the import from:
```typescript
import { fetchPageMeta } from '@/lib/crawler';
```
to:
```typescript
import { fetchPageMeta, fetchHtml, extractInternalLinks } from '@/lib/crawler';
```

Add this new function above `runScanForCustomer`:
```typescript
// Page-discovery source for a site with no resolved GSC connection: the
// homepage's own internal links plus its sitemap.xml, deduped and capped at
// the same budget the GSC path uses. impressions/clicks/ctr are 0 — "no
// search-performance data available," matching the existing convention for
// sitemap-only entries in the GSC path below.
async function discoverPagesWithoutGsc(website: Website): Promise<{ url: string; impressions: number; clicks: number; ctr: number }[]> {
  const [homepageHtml, sitemapUrls] = await Promise.all([
    fetchHtml(website.url),
    fetchSitemapUrls(website.url),
  ]);
  const internalLinks = homepageHtml ? extractInternalLinks(homepageHtml, website.url) : [];
  const discovered = [...new Set([website.url, ...internalLinks, ...sitemapUrls])].slice(0, MAX_PAGES_PER_SCAN);
  return discovered.map((url) => ({ url, impressions: 0, clicks: 0, ctr: 0 }));
}
```

Replace the function body from the top guard through the `performance` assignment — i.e. replace this entire block:
```typescript
export async function runScanForCustomer(customer: Customer, website: Website, scanJobId?: string): Promise<ScanResult> {
  if (!website.gscRefreshToken) {
    throw new Error('Website has not connected Google Search Console');
  }

  const refreshToken = decrypt(website.gscRefreshToken);
  let gscPerformance, sitemapUrls;
  try {
    [gscPerformance, sitemapUrls] = await Promise.all([
      listPagePerformance(refreshToken, website.url),
      fetchSitemapUrls(website.url),
    ]);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      // Anchor on the exact ciphertext that failed, not just the row id: if the
      // customer reconnected while this call was in flight, the row now holds a
      // fresh token and this stale write must no-op rather than overwrite their
      // just-completed success with a false "reconnect needed".
      try {
        await db.website.updateMany({
          where: { id: website.id, gscRefreshToken: website.gscRefreshToken },
          data: { gscReconnectRequired: true },
        });
      } catch (flagErr) {
        console.error(`run-scan: failed to flag reconnect-required for website ${website.id}`, flagErr instanceof Error ? flagErr.message : flagErr);
      }
    }
    throw err;
  }
  // mergeSitemapUrls always appends sitemap-only entries after every GSC entry (see its
  // implementation), so slicing its unsliced output at the gscPerformance boundary reliably
  // separates the two parts below. Reserve up to SITEMAP_RESERVE slots for sitemap-only pages,
  // but backfill any slots it doesn't use back to GSC pages instead of leaving them empty.
  const merged = mergeSitemapUrls(gscPerformance, sitemapUrls);
  const supplemental = merged.slice(gscPerformance.length);
  const sitemapTaken = supplemental.slice(0, SITEMAP_RESERVE);
  const gscBudget = MAX_PAGES_PER_SCAN - sitemapTaken.length;
  const performance = [...gscPerformance.slice(0, gscBudget), ...sitemapTaken];
```
with:
```typescript
export async function runScanForCustomer(customer: Customer, website: Website, scanJobId?: string): Promise<ScanResult> {
  const hasResolvedGsc = Boolean(website.gscRefreshToken) && !website.gscReconnectRequired && Boolean(website.gscPropertyUrl);

  let performance: { url: string; impressions: number; clicks: number; ctr: number }[];
  if (hasResolvedGsc) {
    const refreshToken = decrypt(website.gscRefreshToken!);
    let gscPerformance, sitemapUrls;
    try {
      [gscPerformance, sitemapUrls] = await Promise.all([
        listPagePerformance(refreshToken, website.gscPropertyUrl!),
        fetchSitemapUrls(website.url),
      ]);
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        // Anchor on the exact ciphertext that failed, not just the row id: if the
        // customer reconnected while this call was in flight, the row now holds a
        // fresh token and this stale write must no-op rather than overwrite their
        // just-completed success with a false "reconnect needed".
        try {
          await db.website.updateMany({
            where: { id: website.id, gscRefreshToken: website.gscRefreshToken },
            data: { gscReconnectRequired: true },
          });
        } catch (flagErr) {
          console.error(`run-scan: failed to flag reconnect-required for website ${website.id}`, flagErr instanceof Error ? flagErr.message : flagErr);
        }
      }
      throw err;
    }
    // mergeSitemapUrls always appends sitemap-only entries after every GSC entry (see its
    // implementation), so slicing its unsliced output at the gscPerformance boundary reliably
    // separates the two parts below. Reserve up to SITEMAP_RESERVE slots for sitemap-only pages,
    // but backfill any slots it doesn't use back to GSC pages instead of leaving them empty.
    const merged = mergeSitemapUrls(gscPerformance, sitemapUrls);
    const supplemental = merged.slice(gscPerformance.length);
    const sitemapTaken = supplemental.slice(0, SITEMAP_RESERVE);
    const gscBudget = MAX_PAGES_PER_SCAN - sitemapTaken.length;
    performance = [...gscPerformance.slice(0, gscBudget), ...sitemapTaken];
  } else {
    performance = await discoverPagesWithoutGsc(website);
  }
```

Everything from `const approvedFacts = ...` to the end of the function is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/run-scan.test.ts
```

Expected: PASS, all tests in both the "sitemap quota" (GSC path, unchanged behavior) and "without GSC" (new) describe blocks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/run-scan.ts src/lib/run-scan.test.ts
git commit -m "feat: run-scan discovers pages via homepage crawl + sitemap when no GSC connection exists"
```

---

### Task 7: `scan/route.ts` — remove the hard GSC block, narrow the pending-URL guard

**Files:**
- Modify: `src/app/api/scan/route.ts`
- Test: `src/app/api/scan/route.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `POST /api/scan` no longer 400s for a website with no GSC connection; it 400s only for the legacy "URL not yet confirmed" case.

- [ ] **Step 1: Update the tests**

In `src/app/api/scan/route.test.ts`, remove the test `'returns 400 when the customer has not connected Google Search Console'` entirely, and remove `'returns 400 without enqueueing when the connection is flagged reconnect-required'` entirely (both guards are being removed from this route — a public audit runs regardless of GSC state; `run-scan.ts`'s own `hasResolvedGsc` check, Task 6, already routes correctly).

Add in their place:
```typescript
  it('enqueues a scan for a website with no GSC connection at all', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_1', gscRefreshToken: null, url: 'https://acme.com' },
      websites: [],
    });
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(307);
    expect(db.scanJob.create).toHaveBeenCalledWith({ data: { customerId: 'cust_1', websiteId: 'web_1', status: 'queued' } });
  });
```

Update the existing pending-sentinel test's message assertion — change:
```typescript
    expect(body.error).toContain('verified Search Console property');
```
to:
```typescript
    expect(body.error).toContain('Confirm this website');
```
(keep the rest of that test — mock, request, and `db.scanJob.create` non-call assertion — unchanged).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/scan/route.test.ts
```

Expected: FAIL — the route still 400s when `gscRefreshToken` is null, and the pending-sentinel error message doesn't match yet.

- [ ] **Step 3: Implement**

In `src/app/api/scan/route.ts`, replace the body from the guards onward:
```typescript
  if (!website.gscRefreshToken) {
    return NextResponse.json({ error: 'Connect Google Search Console first' }, { status: 400 });
  }
  if (website.url === PENDING_WEBSITE_URL) {
    return NextResponse.json(
      { error: 'Select a verified Search Console property for this site before running an audit.' },
      { status: 400 }
    );
  }
  if (website.gscReconnectRequired) {
    return NextResponse.json(
      { error: 'Reconnect Google Search Console for this site before running an audit.' },
      { status: 400 }
    );
  }

  await enqueueScanIfNeeded(customer.id, website);
```
with:
```typescript
  if (website.url === PENDING_WEBSITE_URL) {
    return NextResponse.json(
      { error: "Confirm this website's URL before running an audit." },
      { status: 400 }
    );
  }

  await enqueueScanIfNeeded(customer.id, website);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/api/scan/route.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/scan/route.ts src/app/api/scan/route.test.ts
git commit -m "fix: public audits no longer require a GSC connection to run"
```

---

### Task 8: Legacy URL confirmation — new route + minimal Settings UI

**Files:**
- Create: `src/app/api/websites/[id]/confirm-url/route.ts`
- Create: `src/app/api/websites/[id]/confirm-url/route.test.ts`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError`, `PENDING_WEBSITE_URL` (`@/lib/customer`); `normalizeSiteUrl` (`@/lib/entitlements`).
- Produces: `POST /api/websites/[id]/confirm-url` — the one-time fix-up path for the sole legacy row still on the sentinel.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/websites/[id]/confirm-url/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';
import { normalizeSiteUrl } from '@/lib/entitlements';

vi.mock('@/lib/db', () => ({
  db: { website: { update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
  PENDING_WEBSITE_URL: 'https://example-pending-setup.com',
}));

vi.mock('@/lib/entitlements', () => ({
  normalizeSiteUrl: vi.fn((url: string) => new URL(url).hostname),
}));

function makeRequest(url: string): NextRequest {
  const form = new URLSearchParams({ url });
  return new Request('http://localhost:3000/api/websites/w1/confirm-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as unknown as NextRequest;
}

describe('POST /api/websites/[id]/confirm-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'w1' } });

    expect(res.status).toBe(401);
  });

  it('returns 400 when url is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await POST(makeRequest(''), { params: { id: 'w1' } });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the website does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'someone-elses' } });

    expect(res.status).toBe(404);
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the url is already confirmed', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      website: { id: 'w1', url: 'https://already-real.com' },
    });

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('already confirmed');
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('confirms the url and redirects to settings', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      website: { id: 'w1', url: PENDING_WEBSITE_URL },
    });

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'w1' } });

    expect(res.status).toBe(307);
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { url: 'https://real-site.com', normalizedHost: 'real-site.com' },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run "src/app/api/websites/[id]/confirm-url/route.test.ts"
```

Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/websites/[id]/confirm-url/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeSiteUrl } from '@/lib/entitlements';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData();
  const url = form.get('url');
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'A URL is required.' }, { status: 400 });
  }

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, params.id));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  if (website.url !== PENDING_WEBSITE_URL) {
    return NextResponse.json({ error: "This website's URL is already confirmed." }, { status: 400 });
  }

  await db.website.update({
    where: { id: website.id },
    data: { url: url.trim(), normalizedHost: normalizeSiteUrl(url.trim()) },
  });

  return NextResponse.redirect(new URL('/settings', req.url));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run "src/app/api/websites/[id]/confirm-url/route.test.ts"
```

Expected: PASS, all 5 tests.

- [ ] **Step 5: Add the Settings UI block**

In `src/app/settings/page.tsx`, change the per-site render (the `return (...)` inside the `websites.map((site) => { ... })` callback) from:

```tsx
            return (
              <div key={site.id} className="flex flex-col gap-3 rounded-md border border-border p-4">
                <div className="flex items-center justify-between gap-4">
                  {/* ... existing header row ... */}
                </div>

                {reconnectRequired && ( /* ... */ )}

                {propertyPending && ( /* ... */ )}

                <AutoExecuteToggle initialEnabled={site.autoExecuteEnabled} websiteId={site.id} />
              </div>
            );
```

to wrap everything after the outer `<div>` in a ternary keyed on the legacy sentinel:

```tsx
            return (
              <div key={site.id} className="flex flex-col gap-3 rounded-md border border-border p-4">
                {site.url === PENDING_WEBSITE_URL ? (
                  <div className="flex flex-col gap-2 rounded-md border border-[var(--dex-app-warning,#b45309)] p-3">
                    <p className="text-sm text-foreground">
                      Confirm this website&apos;s URL to start auditing it — we have{' '}
                      <span className="font-mono">{site.normalizedHost}</span> from when it was added.
                    </p>
                    <form
                      action={`/api/websites/${site.id}/confirm-url`}
                      method="post"
                      className="flex flex-wrap items-center gap-3"
                    >
                      <input
                        name="url"
                        type="url"
                        required
                        defaultValue={`https://${site.normalizedHost}`}
                        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      />
                      <Button type="submit" size="sm" variant="accent">
                        Confirm URL
                      </Button>
                    </form>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      {/* ... existing header row, byte-for-byte unchanged, just re-indented ... */}
                    </div>

                    {reconnectRequired && ( /* ... existing paragraph, unchanged ... */ )}

                    {propertyPending && ( /* ... existing form, unchanged ... */ )}
                  </>
                )}

                <AutoExecuteToggle initialEnabled={site.autoExecuteEnabled} websiteId={site.id} />
              </div>
            );
```

`computeGscConnectionState`'s call and the `notConnected`/`reconnectRequired`/`propertyPending` derivation earlier in the callback are unchanged — they still run for every site, their results are just only rendered inside the `else` branch now. `AutoExecuteToggle` stays outside both branches (a site's per-page automation setting is independent of whether its URL is confirmed).

- [ ] **Step 6: Run the full suite and typecheck**

```bash
npx vitest run
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') npx tsc --noEmit
```

Expected: all tests pass, no type errors. (No new test for the Settings JSX itself — this codebase has no page-render test harness; the confirm-url route's own tests, Steps 1–4, carry the real coverage for this task's logic.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/websites/[id]/confirm-url/" src/app/settings/page.tsx
git commit -m "feat: add legacy website-URL confirmation route and Settings prompt"
```

---

## Self-Review

**Spec coverage:** Every section of `docs/superpowers/specs/2026-09-12-url-first-public-audits-design.md` maps to a task — Data model → Task 1; Legacy row handling → Task 8; `POST /api/websites` → Task 5; `POST /api/gsc/select-site` → Task 4; `POST /api/scan` → Task 7; `run-scan.ts` branch + new crawler capability → Tasks 2 and 6; `gsc-connection-state.ts` (implied by the spec's "Settings must reflect the split," carried over from earlier session work) → Task 3.

**Placeholder scan:** No TBD/TODO markers; every step has real code, real assertions, real commands.

**Type consistency:** `computeGscConnectionState`'s input shape (Task 3) matches what Task 8's Settings page already has available on `site` (a full Prisma `Website` row via `resolveWebsiteForRequest`, unchanged). `discoverPagesWithoutGsc`'s return type (`{ url, impressions, clicks, ctr }[]`) matches the shape `mergeSitemapUrls`/the GSC path already produce, so the shared downstream code in `run-scan.ts` (Task 6) needs no adaptation. `fetchHtml`'s signature (Task 2) matches exactly how Task 6 calls it. `gscPropertyUrl: string | null` (Task 1) is read identically in Tasks 3, 4, and 6.
