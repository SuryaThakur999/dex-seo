# Multi-Site Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace add and switch between multiple websites under its existing default `ClientProfile`, closing the gap where the backend has supported up to `maxWebsites` (default 3) sites since Milestone B but no route or page ever called the function that creates one.

**Architecture:** One ownership-checked resolver (`resolveWebsiteForRequest`) replaces the `customer.clientProfiles[0].websites[0]` idiom duplicated across nine files. Site identity moves into the URL (`/dashboard/[websiteId]`, bare `/dashboard` redirects to the default). A new `/api/websites` route plus a restructured `/settings` page let a user add a site and connect Search Console for it, reusing an existing GSC token from a sibling site when one exists so the user never re-authorizes the same Google account twice.

**Tech Stack:** Next.js App Router, Prisma/Postgres (Neon), Clerk auth, Vitest.

## Global Constraints

- No Prisma schema changes — `Website`/`ClientProfile` already have everything this needs (`maxWebsites`, `createWebsiteWithEntitlementCheck`).
- Out of scope: a `ClientProfile` switcher (`maxClientProfiles` stays 1, untouched); scanning arbitrary/unowned URLs (that's brief-section-5, not this).
- `/review` is NOT restructured — it already queries by `customerId` (workspace-wide), not per-website. Do not add a `[websiteId]` segment there.
- Every `websiteId`-scoped route/page: an id that doesn't belong to the caller throws `WebsiteNotFoundError`, handled as 404 — same posture as every other ownership check in this codebase (no distinguishing "doesn't exist" from "not yours").
- Gate before every commit that touches app code: `npx tsc --noEmit`, `npx vitest run`. `npx next build` is required for Task 13, 14, and 15 (page/route-tree changes) — not required for library/route-only tasks that don't touch a page file.

---

## Task 1: `resolveWebsiteForRequest` resolver

**Files:**
- Modify: `src/lib/customer.ts`
- Modify: `src/lib/customer.test.ts`

**Interfaces:**
- Consumes: `ensureCustomer`, `PENDING_WEBSITE_URL` (both already exported from this file, unchanged), `db` from `./db`.
- Produces: `export class WebsiteNotFoundError extends Error {}`, `export async function resolveWebsiteForRequest(clerkUserId: string, websiteId?: string): Promise<{ customer: Customer; website: Website; websites: Website[] }>`. Every later task that currently does its own `customer.clientProfiles[0].websites[0]` lookup calls this instead. `website.clientProfileId` (a real field on the Prisma `Website` type) is what Task 2 uses to create a new website under the same profile.

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/lib/customer.test.ts` (extend the existing `vi.mock('./db', ...)` at the top of the file first — see Step 2 below — then add this new `describe` block after the existing `describe('ensureCustomer', ...)` block):

```typescript
import { resolveWebsiteForRequest, WebsiteNotFoundError } from './customer';

describe('resolveWebsiteForRequest', () => {
  const upsertedCustomer = {
    id: 'c1',
    clerkUserId: 'user_1',
    clientProfiles: [{ websites: [{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }] }],
  };

  it('returns the first website and full sibling list when no websiteId is given', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      websites: [{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }],
    });

    const result = await resolveWebsiteForRequest('user_1');

    expect(result.website).toEqual({ id: 'w1', url: 'https://a.com' });
    expect(result.websites).toEqual([{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }]);
  });

  it('returns the matching website when a valid websiteId is given', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      websites: [{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }],
    });

    const result = await resolveWebsiteForRequest('user_1', 'w2');

    expect(result.website).toEqual({ id: 'w2', url: 'https://b.com' });
  });

  it('throws WebsiteNotFoundError for a websiteId that does not belong to this customer', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      websites: [{ id: 'w1', url: 'https://a.com' }],
    });

    await expect(resolveWebsiteForRequest('user_1', 'someone-elses-website')).rejects.toThrow(WebsiteNotFoundError);
  });
});
```

- [ ] **Step 2: Extend the db mock and run to verify the new tests fail**

At the top of `src/lib/customer.test.ts`, change the existing mock:

```typescript
vi.mock('./db', () => ({
  db: {
    customer: {
      upsert: vi.fn(),
    },
  },
}));
```

to:

```typescript
vi.mock('./db', () => ({
  db: {
    customer: {
      upsert: vi.fn(),
    },
    clientProfile: {
      findFirst: vi.fn(),
    },
  },
}));
```

Run: `npx vitest run src/lib/customer.test.ts`
Expected: FAIL — `resolveWebsiteForRequest` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/customer.ts`, after the existing `ensureCustomer` function:

```typescript
export class WebsiteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebsiteNotFoundError';
  }
}

/**
 * Resolves which Website a request is scoped to. With no websiteId, returns
 * the default (first-created) website — today's implicit single-site
 * behavior, unchanged. With a websiteId, ownership-checks it against this
 * customer's own websites and returns that one instead.
 */
export async function resolveWebsiteForRequest(
  clerkUserId: string,
  websiteId?: string
): Promise<{ customer: Customer; website: Website; websites: Website[] }> {
  const { customer, website: defaultWebsite } = await ensureCustomer(clerkUserId, PENDING_WEBSITE_URL);
  const profile = await db.clientProfile.findFirst({
    where: { customerId: customer.id, isDefault: true },
    include: { websites: { orderBy: { createdAt: 'asc' } } },
  });
  const websites = profile?.websites ?? [defaultWebsite];

  if (!websiteId) return { customer, website: defaultWebsite, websites };

  const website = websites.find((w) => w.id === websiteId);
  if (!website) {
    throw new WebsiteNotFoundError(`Website ${websiteId} not found on this workspace.`);
  }
  return { customer, website, websites };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/customer.test.ts`
Expected: PASS (5 tests: 2 existing `ensureCustomer` + 3 new)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/customer.ts src/lib/customer.test.ts
git commit -m "$(cat <<'EOF'
feat: add resolveWebsiteForRequest, the shared multi-site resolver

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 2: `POST /api/websites` — add a website

**Files:**
- Create: `src/app/api/websites/route.ts`
- Create: `src/app/api/websites/route.test.ts`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest` (Task 1), `createWebsiteWithEntitlementCheck`, `EntitlementLimitError`, `DuplicateWebsiteError` (all from `@/lib/entitlements`, already exist), `auth` from `@clerk/nextjs/server`, `db` from `@/lib/db`.
- Produces: `POST` handler returning `{ id, url, gscInherited: boolean }` on success (201), or `{ error: string }` (400) on an entitlement/duplicate failure. Consumed by the "Add website" form in Task 14.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/websites/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest } from '@/lib/customer';
import { createWebsiteWithEntitlementCheck, EntitlementLimitError, DuplicateWebsiteError } from '@/lib/entitlements';

vi.mock('@/lib/db', () => ({
  db: { website: { findFirst: vi.fn(), update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({ resolveWebsiteForRequest: vi.fn() }));

vi.mock('@/lib/entitlements', () => ({
  createWebsiteWithEntitlementCheck: vi.fn(),
  EntitlementLimitError: class EntitlementLimitError extends Error {},
  DuplicateWebsiteError: class DuplicateWebsiteError extends Error {},
}));

function makeRequest(url: string): NextRequest {
  return new Request('http://localhost:3000/api/websites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }) as unknown as NextRequest;
}

describe('POST /api/websites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest('https://newsite.com'));

    expect(res.status).toBe(401);
  });

  it('returns 400 when url is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await POST(makeRequest(''));

    expect(res.status).toBe(400);
  });

  it('creates a website with no GSC inheritance when no sibling has a token', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: null }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w2',
      url: 'https://newsite.com',
    });

    const res = await POST(makeRequest('https://newsite.com'));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: 'w2', url: 'https://newsite.com', gscInherited: false });
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('inherits a sibling website\'s GSC token onto the new website', async () => {
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
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w2' },
      data: { gscRefreshToken: 'encrypted-token' },
    });
  });

  it('returns 400 with the message when the entitlement limit is hit', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: null }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new EntitlementLimitError('This client profile already has 3 of 3 allowed websites.')
    );

    const res = await POST(makeRequest('https://newsite.com'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('This client profile already has 3 of 3 allowed websites.');
  });

  it('returns 400 with the message when the host is a duplicate', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: null }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DuplicateWebsiteError('newsite.com is already registered on this client profile.')
    );

    const res = await POST(makeRequest('https://newsite.com'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('newsite.com is already registered on this client profile.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/websites/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/websites/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest } from '@/lib/customer';
import { createWebsiteWithEntitlementCheck, EntitlementLimitError, DuplicateWebsiteError } from '@/lib/entitlements';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const { url } = body;
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'A URL is required.' }, { status: 400 });
  }

  const { website: defaultWebsite, websites } = await resolveWebsiteForRequest(userId);

  try {
    const created = await createWebsiteWithEntitlementCheck({
      clientProfileId: defaultWebsite.clientProfileId,
      url,
    });

    const siblingWithToken = websites.find((w) => w.gscRefreshToken);
    const gscInherited = Boolean(siblingWithToken);
    if (siblingWithToken) {
      await db.website.update({
        where: { id: created.id },
        data: { gscRefreshToken: siblingWithToken.gscRefreshToken },
      });
    }

    return NextResponse.json({ id: created.id, url: created.url, gscInherited }, { status: 201 });
  } catch (err) {
    if (err instanceof EntitlementLimitError || err instanceof DuplicateWebsiteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/websites/route.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/websites/route.ts src/app/api/websites/route.test.ts
git commit -m "$(cat <<'EOF'
feat: POST /api/websites — add a website with GSC-token inheritance

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 3: `/api/gsc/connect` — target a specific website

**Files:**
- Modify: `src/app/api/gsc/connect/route.ts`
- Create: `src/app/api/gsc/connect/route.test.ts`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError` (Task 1), `buildAuthUrl` from `@/lib/google-oauth` (existing, unchanged).
- Produces: `GET` handler requiring `?websiteId=`, setting a second cookie `gsc_oauth_website_id` alongside the existing `gsc_oauth_state`. Consumed by Task 4 (`/api/gsc/callback` reads this cookie) and Task 14 (the settings page's "Connect Search Console" link).

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/gsc/connect/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { buildAuthUrl } from '@/lib/google-oauth';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/google-oauth', () => ({ buildAuthUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/mock') }));

function makeRequest(websiteId?: string): NextRequest {
  const url = websiteId
    ? `http://localhost:3000/api/gsc/connect?websiteId=${websiteId}`
    : 'http://localhost:3000/api/gsc/connect';
  return new Request(url) as unknown as NextRequest;
}

describe('GET /api/gsc/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest('w1'));

    expect(res.status).toBe(401);
  });

  it('returns 400 when websiteId is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
  });

  it('returns 400 when websiteId does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new WebsiteNotFoundError('not found')
    );

    const res = await GET(makeRequest('foreign-id'));

    expect(res.status).toBe(400);
  });

  it('redirects to Google and sets both cookies for a valid websiteId', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1' },
      websites: [{ id: 'w1' }],
    });

    const res = await GET(makeRequest('w1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://accounts.google.com/o/oauth2/mock');
    const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
    const cookieString = setCookies.join('; ');
    expect(cookieString).toContain('gsc_oauth_state=');
    expect(cookieString).toContain('gsc_oauth_website_id=w1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/gsc/connect/route.test.ts`
Expected: FAIL — current route doesn't check `websiteId` at all, so the 400 tests fail (200/307 with no validation).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/app/api/gsc/connect/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { buildAuthUrl } from '@/lib/google-oauth';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const websiteId = new URL(req.url).searchParams.get('websiteId');
  if (!websiteId) {
    return NextResponse.json({ error: 'websiteId is required' }, { status: 400 });
  }

  try {
    await resolveWebsiteForRequest(userId, websiteId);
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 400 });
    }
    throw err;
  }

  const state = randomBytes(32).toString('hex');
  const response = NextResponse.redirect(buildAuthUrl(state));
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  };
  response.cookies.set('gsc_oauth_state', state, cookieOptions);
  response.cookies.set('gsc_oauth_website_id', websiteId, cookieOptions);
  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/gsc/connect/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/gsc/connect/route.ts src/app/api/gsc/connect/route.test.ts
git commit -m "$(cat <<'EOF'
feat: target a specific website in the GSC connect flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 4: `/api/gsc/callback` — store the token on the right website

**Files:**
- Modify: `src/app/api/gsc/callback/route.ts`
- Create: `src/app/api/gsc/callback/route.test.ts`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError` (Task 1), `exchangeCodeForRefreshToken` from `@/lib/google-oauth` (existing, unchanged), `encrypt` from `@/lib/crypto` (existing, unchanged).
- Produces: `GET` handler that reads the `gsc_oauth_website_id` cookie set by Task 3 and stores the token on that specific website.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/gsc/callback/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { exchangeCodeForRefreshToken } from '@/lib/google-oauth';
import { encrypt } from '@/lib/crypto';

vi.mock('@/lib/db', () => ({
  db: { website: { update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/google-oauth', () => ({ exchangeCodeForRefreshToken: vi.fn() }));

vi.mock('@/lib/crypto', () => ({ encrypt: vi.fn((v: string) => `encrypted:${v}`) }));

function makeRequest(params: { code?: string; state?: string }, cookies: Record<string, string>): NextRequest {
  const search = new URLSearchParams();
  if (params.code) search.set('code', params.code);
  if (params.state) search.set('state', params.state);
  const req = new Request(`http://localhost:3000/api/gsc/callback?${search.toString()}`) as unknown as NextRequest;
  (req as unknown as { cookies: { get: (name: string) => { value: string } | undefined } }).cookies = {
    get: (name: string) => (cookies[name] !== undefined ? { value: cookies[name] } : undefined),
  };
  return req;
}

describe('GET /api/gsc/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w1' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 when the gsc_oauth_website_id cookie is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 when state does not match', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(
      makeRequest({ code: 'c', state: 'wrong' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w1' })
    );

    expect(res.status).toBe(400);
  });

  it('stores the token on the website named by the cookie, not the default', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (exchangeCodeForRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue('raw-refresh-token');
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w2' },
      websites: [{ id: 'w1' }, { id: 'w2' }],
    });

    const res = await GET(
      makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w2' })
    );

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'w2');
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w2' },
      data: { gscRefreshToken: 'encrypted:raw-refresh-token' },
    });
    expect(res.status).toBe(307);
  });

  it('returns 400 when the websiteId from the cookie is no longer valid', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (exchangeCodeForRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue('raw-refresh-token');
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('gone'));

    const res = await GET(
      makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w2' })
    );

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/gsc/callback/route.test.ts`
Expected: FAIL — current route always resolves `website[0]` via a raw `db.customer.findUnique`, ignoring the new cookie.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/app/api/gsc/callback/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForRefreshToken } from '@/lib/google-oauth';
import { encrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const expectedState = req.cookies.get('gsc_oauth_state')?.value;
  const websiteId = req.cookies.get('gsc_oauth_website_id')?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response('Invalid OAuth callback', { status: 400 });
  }
  if (!websiteId) {
    return NextResponse.json({ error: 'Missing website reference — start the connect flow again.' }, { status: 400 });
  }

  try {
    const refreshToken = await exchangeCodeForRefreshToken(code);
    const { website } = await resolveWebsiteForRequest(userId, websiteId);

    await db.website.update({
      where: { id: website.id },
      data: { gscRefreshToken: encrypt(refreshToken) },
    });
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found — start the connect flow again.' }, { status: 400 });
    }
    if (err instanceof Error && err.message.includes('refresh_token')) {
      return NextResponse.json(
        { error: 'Google did not return a refresh token. Revoke prior access at myaccount.google.com/permissions and try again.' },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to connect Google Search Console.' }, { status: 500 });
  }

  const response = NextResponse.redirect(new URL('/settings', req.url));
  response.cookies.delete('gsc_oauth_state');
  response.cookies.delete('gsc_oauth_website_id');
  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/gsc/callback/route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/gsc/callback/route.ts src/app/api/gsc/callback/route.test.ts
git commit -m "$(cat <<'EOF'
feat: store the GSC token on the website named by the OAuth cookie

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 5: `/api/gsc/select-site` — target a specific website

**Files:**
- Modify: `src/app/api/gsc/select-site/route.ts`
- Create: `src/app/api/gsc/select-site/route.test.ts`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError` (Task 1), `decrypt` from `@/lib/crypto`, `listVerifiedSites` from `@/lib/gsc-client`, `normalizeSiteUrl` from `@/lib/entitlements` (all existing, unchanged).
- Produces: `POST` handler reading an explicit `websiteId` form field (falling back to the default website when absent, so the existing first-site flow keeps working unchanged).

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/gsc/select-site/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest } from '@/lib/customer';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites } from '@/lib/gsc-client';

vi.mock('@/lib/db', () => ({
  db: { website: { update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({ resolveWebsiteForRequest: vi.fn() }));

vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn((v: string) => `decrypted:${v}`) }));

vi.mock('@/lib/gsc-client', () => ({ listVerifiedSites: vi.fn() }));

function makeRequest(fields: Record<string, string>): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request('http://localhost:3000/api/gsc/select-site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as unknown as NextRequest;
}

describe('POST /api/gsc/select-site', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(401);
  });

  it('updates the website named by an explicit websiteId field, not the default', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w2', gscRefreshToken: 'token-2' },
      websites: [{ id: 'w1' }, { id: 'w2' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockResolvedValue(['https://acme.com']);

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com', websiteId: 'w2' }));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'w2');
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w2' },
      data: { url: 'https://acme.com', normalizedHost: 'acme.com' },
    });
    expect(res.status).toBe(307);
  });

  it('falls back to the default website when websiteId is absent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'token-1' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockResolvedValue(['https://acme.com']);

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', undefined);
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { url: 'https://acme.com', normalizedHost: 'acme.com' },
    });
    expect(res.status).toBe(307);
  });

  it('returns 400 when the property is not verified for this account', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'token-1' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockResolvedValue(['https://other.com']);

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(400);
    expect(db.website.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/gsc/select-site/route.test.ts`
Expected: FAIL — current route always resolves `website[0]` via a raw `db.customer.findUnique` and ignores any `websiteId` field.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/app/api/gsc/select-site/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites } from '@/lib/gsc-client';
import { normalizeSiteUrl } from '@/lib/entitlements';
import { resolveWebsiteForRequest } from '@/lib/customer';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData();
  const siteUrl = form.get('siteUrl');
  const websiteId = form.get('websiteId');
  if (typeof siteUrl !== 'string' || !siteUrl) {
    return NextResponse.json({ error: 'Missing siteUrl' }, { status: 400 });
  }

  const { website } = await resolveWebsiteForRequest(userId, typeof websiteId === 'string' ? websiteId : undefined);
  if (!website.gscRefreshToken) {
    return NextResponse.json({ error: 'Connect Google Search Console first' }, { status: 400 });
  }

  try {
    const refreshToken = decrypt(website.gscRefreshToken);
    const verifiedSites = await listVerifiedSites(refreshToken);

    if (!verifiedSites.includes(siteUrl)) {
      return NextResponse.json(
        { error: 'Not a verified Search Console property for this account' },
        { status: 400 }
      );
    }

    await db.website.update({ where: { id: website.id }, data: { url: siteUrl, normalizedHost: normalizeSiteUrl(siteUrl) } });
  } catch {
    return NextResponse.json({ error: 'Failed to verify or save the selected property.' }, { status: 500 });
  }

  return NextResponse.redirect(new URL('/settings', req.url));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/gsc/select-site/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/gsc/select-site/route.ts src/app/api/gsc/select-site/route.test.ts
git commit -m "$(cat <<'EOF'
feat: target a specific website when selecting a Search Console property

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 6: `/api/command-bar` — scope to the posted `websiteId`

**Files:**
- Modify: `src/app/api/command-bar/route.ts`
- Modify: `src/app/api/command-bar/route.test.ts`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError` (Task 1).
- Produces: `POST` body gains an optional `websiteId`; every href in a `CommandBarResponse` that pointed at `/dashboard?tab=...` now points at `/dashboard/${website.id}?tab=...`. Consumed by Task 7 (`CommandBar` component sends this field).

- [ ] **Step 1: Add failing tests to the existing test file**

The existing `src/app/api/command-bar/route.test.ts` mocks `@/lib/db` directly and builds a `customer` fixture inline (see its `customerWithWebsite` helper). Add this mock alongside the existing ones at the top of the file:

```typescript
vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));
```

Import it too:

```typescript
import { resolveWebsiteForRequest } from '@/lib/customer';
```

Then add these tests inside the existing `describe('POST /api/command-bar', ...)` block:

```typescript
  it('resolves the website named by an explicit websiteId in the body, not the default', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_2' },
      website: { id: 'web_2', url: 'https://second-site.com', gscRefreshToken: 'token' },
      websites: [],
    });
    (db.action.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const res = await POST(
      new Request('http://localhost:3000/api/command-bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'pending', websiteId: 'web_2' }),
      }) as unknown as NextRequest
    );
    const body = await res.json();

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'web_2');
    expect(db.action.count).toHaveBeenCalledWith({ where: { websiteId: 'web_2', status: 'pending' } });
    expect(body.actions[0].href).toBe('/dashboard/web_2?tab=review');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/command-bar/route.test.ts`
Expected: FAIL — the route doesn't import or call `resolveWebsiteForRequest` yet, and hrefs still read `/dashboard?tab=review`.

- [ ] **Step 3: Modify the implementation**

Replace the full contents of `src/app/api/command-bar/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeSiteUrl } from '@/lib/entitlements';
import { enqueueScanIfNeeded } from '@/lib/scan-trigger';
import { computeOutcomesSummary } from '@/lib/dashboard-stats';
import { parseCommandBarIntent } from '@/lib/command-bar/intent-router';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export interface CommandBarAction {
  label: string;
  href: string;
}

export interface CommandBarResponse {
  message: string;
  context: { websiteUrl: string; gscConnected: boolean };
  actions: CommandBarAction[];
}

// Explicit allowlist: every branch below calls only existing, already-
// authorized read/write functions scoped to this customer's own website.
// There is no code path from `text` to a shell command, a raw SQL string,
// or an arbitrary tool call — parseCommandBarIntent only ever returns one
// of the five fixed shapes handled here: run_audit, list_pending, list_outcomes,
// request_content, or help.
export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const { text, websiteId } = await req.json();
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  let customer, website;
  try {
    ({ customer, website } = await resolveWebsiteForRequest(userId, typeof websiteId === 'string' ? websiteId : undefined));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  const context = { websiteUrl: website.url, gscConnected: Boolean(website.gscRefreshToken) };
  const intent = parseCommandBarIntent(text);
  const body: CommandBarResponse = await handleIntent(intent, customer.id, website, context);

  return NextResponse.json(body);
}

async function handleIntent(
  intent: ReturnType<typeof parseCommandBarIntent>,
  customerId: string,
  website: { id: string; url: string; gscRefreshToken: string | null },
  context: CommandBarResponse['context']
): Promise<CommandBarResponse> {
  switch (intent.type) {
    case 'run_audit': {
      if (!website.gscRefreshToken) {
        return {
          message: 'Connect Google Search Console before running an audit.',
          context,
          actions: [{ label: 'Connect Search Console', href: `/api/gsc/connect?websiteId=${website.id}` }],
        };
      }
      if (intent.pastedUrl && normalizeSiteUrl(intent.pastedUrl) !== normalizeSiteUrl(website.url)) {
        return {
          message: `Dex currently audits your connected site (${website.url}) only — it doesn't scan arbitrary URLs yet. Say "audit" with nothing else to check your connected site.`,
          context,
          actions: [],
        };
      }
      const { enqueued } = await enqueueScanIfNeeded(customerId, website as never);
      return {
        message: enqueued
          ? `Started an audit of ${website.url}. Watch progress in the Overview tab.`
          : 'An audit is already running or queued for this site.',
        context,
        actions: [{ label: 'View scan status', href: `/dashboard/${website.id}?tab=overview` }],
      };
    }

    case 'list_pending': {
      const count = await db.action.count({ where: { websiteId: website.id, status: 'pending' } });
      return {
        message:
          count === 0
            ? 'Nothing pending review right now.'
            : `${count} change${count === 1 ? '' : 's'} waiting for your review.`,
        context,
        actions: [{ label: 'Open Review Queue', href: `/dashboard/${website.id}?tab=review` }],
      };
    }

    case 'list_outcomes': {
      const actions = await db.action.findMany({
        where: { websiteId: website.id },
        select: { outcomeMeasuredAt: true, baselinePerformance: true, outcomePerformance: true },
      });
      const summary = computeOutcomesSummary(actions);
      return {
        message:
          summary.measuredCount === 0
            ? 'No measured outcomes yet — results appear 28 days after an approved change.'
            : `${summary.winCount} of ${summary.measuredCount} measured changes improved clicks.`,
        context,
        actions: [{ label: 'Open Outcomes', href: `/dashboard/${website.id}?tab=outcomes` }],
      };
    }

    case 'request_content': {
      const params = new URLSearchParams();
      if (intent.platform) params.set('platform', intent.platform);
      if (intent.topic) params.set('topic', intent.topic);
      const query = params.toString();
      return {
        message: intent.platform
          ? `Opening Content Studio to draft a ${intent.platform} post${intent.topic ? ` about ${intent.topic}` : ''}.`
          : 'Opening Content Studio.',
        context,
        actions: [{ label: 'Open Content Studio', href: `/studio${query ? `?${query}` : ''}` }],
      };
    }

    case 'help':
    default:
      return {
        message: 'I can run an audit, list pending drafts, or summarize measured outcomes. Try "audit", "pending", or "outcomes".',
        context,
        actions: [],
      };
  }
}
```

**Confirmed unchanged:** `src/lib/scan-trigger.ts`'s `enqueueScanIfNeeded(customerId: string, website: Website)` takes a `customerId` as its first argument (used only to stamp `ScanJob.customerId`) — the code above already destructures `customer` from `resolveWebsiteForRequest` and passes `customer.id`, matching that signature exactly. Do not pass `website.id` there — that would silently write the wrong value into `ScanJob.customerId`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/command-bar/route.test.ts`
Expected: PASS (all existing tests + the new one — existing tests will need their own hrefs updated too, since they currently assert `/dashboard?tab=overview`/`/dashboard?tab=review` style paths. Update those existing assertions to expect `/dashboard/web_1?tab=overview` etc., matching whatever website id each existing test's fixture uses — check the existing `customerWithWebsite` helper for the id it sets on the website, and use that same id in the updated assertions.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/command-bar/route.ts src/app/api/command-bar/route.test.ts
git commit -m "$(cat <<'EOF'
feat: scope the command bar to an explicit websiteId

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 7: `CommandBar` component — send `websiteId`

**Files:**
- Modify: `src/components/dashboard/command-bar.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CommandBar` now requires a `websiteId: string` prop, included in its POST body. Consumed by Task 13 (`dashboard/[websiteId]/page.tsx` passes `website.id`).

No test file for this task — the codebase has no component-level test convention (established in the Content Studio milestone: `vitest.config.ts` runs `environment: 'node'`, and this exact component already had no test file before this change).

- [ ] **Step 1: Modify the component**

In `src/components/dashboard/command-bar.tsx`, change the function signature and the fetch body:

Change:
```typescript
export function CommandBar() {
```
to:
```typescript
export function CommandBar({ websiteId }: { websiteId: string }) {
```

Change:
```typescript
        body: JSON.stringify({ text }),
```
to:
```typescript
        body: JSON.stringify({ text, websiteId }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL at this point — `src/app/dashboard/page.tsx` still renders `<CommandBar />` with no `websiteId` prop. This is expected; Task 13 fixes the call site. Do not attempt to fix `dashboard/page.tsx` in this task — that file is being restructured wholesale in Task 13, and a throwaway fix here would just be redone.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/command-bar.tsx
git commit -m "$(cat <<'EOF'
feat: CommandBar sends its scoped websiteId

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

(A commit with a known, temporary `tsc` failure that the very next tasks resolve is acceptable here — Tasks 8-13 all touch the same call site incrementally. If your workflow requires green `tsc` at every commit, hold this change uncommitted and fold it into Task 13's commit instead; either ordering is fine as long as the final state after Task 13 typechecks cleanly.)

---

## Task 8: `/api/scan` — accept and redirect with `websiteId`

**Files:**
- Modify: `src/app/api/scan/route.ts`
- Modify: `src/app/api/scan/route.test.ts`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest` (Task 1).
- Produces: `POST` reads `websiteId` from posted form data (falls back to the default website when absent), redirects to `/dashboard/${website.id}` instead of the bare `/dashboard`.

- [ ] **Step 1: Add a failing test to the existing test file**

The existing `src/app/api/scan/route.test.ts` builds requests with a bare `new Request(..., { method: 'POST' })` (no body). Add this mock alongside the existing ones:

```typescript
vi.mock('@/lib/customer', () => ({ resolveWebsiteForRequest: vi.fn() }));
```

Import it:

```typescript
import { resolveWebsiteForRequest } from '@/lib/customer';
```

Add a helper for a request carrying form data, and this test, inside the existing `describe('POST /api/scan', ...)` block:

```typescript
function makeFormRequest(websiteId?: string): NextRequest {
  const form = new URLSearchParams();
  if (websiteId) form.set('websiteId', websiteId);
  return new Request('http://localhost:3000/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as unknown as NextRequest;
}

  it('redirects to the dashboard for the resolved website, not a bare /dashboard', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_2', gscRefreshToken: 'token' },
      websites: [],
    });
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeFormRequest('web_2'));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'web_2');
    expect(res.headers.get('location')).toContain('/dashboard/web_2');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/scan/route.test.ts`
Expected: FAIL — the route redirects to a bare `/dashboard` and doesn't call `resolveWebsiteForRequest`.

- [ ] **Step 3: Modify the implementation**

Replace the full contents of `src/app/api/scan/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { enqueueScanIfNeeded } from '@/lib/scan-trigger';
import { resolveWebsiteForRequest } from '@/lib/customer';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData().catch(() => null);
  const websiteId = form?.get('websiteId');

  const { customer, website } = await resolveWebsiteForRequest(
    userId,
    typeof websiteId === 'string' ? websiteId : undefined
  );
  if (!website.gscRefreshToken) {
    return NextResponse.json({ error: 'Connect Google Search Console first' }, { status: 400 });
  }

  await enqueueScanIfNeeded(customer.id, website);

  return NextResponse.redirect(new URL(`/dashboard/${website.id}`, req.url));
}
```

Check `src/lib/scan-trigger.ts`'s `enqueueScanIfNeeded` signature before finalizing this — the pre-existing call already passed `customer!.id` as the first argument (see the file as it exists before this task), so this task keeps that same first argument; only the resolution mechanism (`resolveWebsiteForRequest` instead of a raw `db.customer.findUnique`) and the redirect target change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/scan/route.test.ts`
Expected: PASS (all existing tests + the new one)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: still shows the known `dashboard/page.tsx` / `CommandBar` mismatch from Task 7 — unrelated to this task, resolved in Task 13.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/scan/route.ts src/app/api/scan/route.test.ts
git commit -m "$(cat <<'EOF'
feat: scan trigger accepts an explicit websiteId and redirects there

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 9: `/api/settings/auto-execute` — scope to `websiteId`

**Files:**
- Modify: `src/app/api/settings/auto-execute/route.ts`
- Modify: `src/app/api/settings/auto-execute/route.test.ts`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError` (Task 1).
- Produces: `POST` body gains a required `websiteId`. Consumed by Task 10 (`AutoExecuteToggle` sends it).

- [ ] **Step 1: Add failing tests to the existing test file**

Add this mock alongside the existing ones in `src/app/api/settings/auto-execute/route.test.ts`:

```typescript
vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));
```

Import it:

```typescript
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
```

Replace the existing `makeRequest` helper (it currently only sends `enabled`) with one that also sends `websiteId`:

```typescript
function makeRequest(enabled: boolean, websiteId = 'web_1'): NextRequest {
  return new Request('http://localhost:3000/api/settings/auto-execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, websiteId }),
  }) as unknown as NextRequest;
}
```

Update the existing "toggles autoExecuteEnabled..." test to mock `resolveWebsiteForRequest` instead of `db.customer.findUnique`:

```typescript
  it('toggles autoExecuteEnabled and records an audit event', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_1' },
      websites: [],
    });

    const res = await POST(makeRequest(true, 'web_1'));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'web_1');
    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.website.update).toHaveBeenCalledWith({ where: { id: 'web_1' }, data: { autoExecuteEnabled: true } });
  });
```

Replace the existing "returns 404 when no customer row exists" test (it mocked `db.customer.findUnique` returning `null` — that path no longer exists once `resolveWebsiteForRequest` is used, since `ensureCustomer` inside it always creates a customer) with a foreign-website test instead:

```typescript
  it('returns 404 when websiteId does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeRequest(true, 'foreign-id'));

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/settings/auto-execute/route.test.ts`
Expected: FAIL — the route still uses the raw `db.customer.findUnique` lookup and ignores `websiteId`.

- [ ] **Step 3: Modify the implementation**

Replace the full contents of `src/app/api/settings/auto-execute/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildAuditLogEntryArgs } from '@/lib/audit-log';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const enabled = Boolean(body.enabled);
  const websiteId = typeof body.websiteId === 'string' ? body.websiteId : undefined;

  let customer, website;
  try {
    ({ customer, website } = await resolveWebsiteForRequest(userId, websiteId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  await db.$transaction([
    db.website.update({ where: { id: website.id }, data: { autoExecuteEnabled: enabled } }),
    db.auditLogEntry.create(buildAuditLogEntryArgs(customer.id, 'auto_execute_toggled', { enabled, at: new Date().toISOString() })),
  ]);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/settings/auto-execute/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: still shows the known `dashboard/page.tsx` / `CommandBar` mismatch and now also a `settings/page.tsx` / `AutoExecuteToggle` mismatch — both resolved by Tasks 13-14.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/settings/auto-execute/route.ts src/app/api/settings/auto-execute/route.test.ts
git commit -m "$(cat <<'EOF'
feat: scope auto-execute toggling to an explicit websiteId

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 10: `AutoExecuteToggle` component — send `websiteId`

**Files:**
- Modify: `src/components/auto-execute-toggle.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AutoExecuteToggle` now requires a `websiteId: string` prop, included in its POST body. Consumed by Task 14 (`settings/page.tsx`, once per website row).

No test file for this task (same no-component-tests convention as Task 7).

- [ ] **Step 1: Modify the component**

In `src/components/auto-execute-toggle.tsx`, change:

```typescript
export function AutoExecuteToggle({ initialEnabled }: { initialEnabled: boolean }) {
```
to:
```typescript
export function AutoExecuteToggle({ initialEnabled, websiteId }: { initialEnabled: boolean; websiteId: string }) {
```

Change:
```typescript
        body: JSON.stringify({ enabled: checked }),
```
to:
```typescript
        body: JSON.stringify({ enabled: checked, websiteId }),
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auto-execute-toggle.tsx
git commit -m "$(cat <<'EOF'
feat: AutoExecuteToggle sends its scoped websiteId

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

(Same note as Task 7: `tsc` will still show the known, expected `settings/page.tsx` call-site mismatch until Task 14. Do not fix it here.)

---

## Task 11: `SiteSwitcher` component

**Files:**
- Create: `src/components/app-shell/site-switcher.tsx`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation`.
- Produces: `SiteSwitcher(props: { websites: { id: string; url: string }[]; currentWebsiteId: string })`. Consumed by Task 12 (`UtilityBar`).

No test file (component convention, as above).

- [ ] **Step 1: Write the component**

```tsx
// src/components/app-shell/site-switcher.tsx
'use client';

import { useRouter } from 'next/navigation';

export function SiteSwitcher({
  websites,
  currentWebsiteId,
}: {
  websites: { id: string; url: string }[];
  currentWebsiteId: string;
}) {
  const router = useRouter();

  return (
    <select
      value={currentWebsiteId}
      onChange={(e) => router.push(`/dashboard/${e.target.value}`)}
      aria-label="Switch website"
      className="h-8 rounded-md border border-[var(--dex-app-border-strong)] bg-transparent px-2 font-mono text-sm text-foreground"
    >
      {websites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.url}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file (still the known pending call-site mismatches from earlier tasks).

- [ ] **Step 3: Commit**

```bash
git add src/components/app-shell/site-switcher.tsx
git commit -m "$(cat <<'EOF'
feat: SiteSwitcher component for navigating between websites

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 12: `UtilityBar` — render the switcher

**Files:**
- Modify: `src/components/app-shell/utility-bar.tsx`

**Interfaces:**
- Consumes: `SiteSwitcher` (Task 11).
- Produces: `UtilityBar` gains two new props: `websites: { id: string; url: string }[]` and `currentWebsiteId: string`. Consumed by Task 13.

No test file (component convention).

- [ ] **Step 1: Modify the component**

Replace the full contents of `src/components/app-shell/utility-bar.tsx`:

```tsx
import { UserButton } from '@clerk/nextjs';
import { CloudCheck, CloudSlash } from '@phosphor-icons/react/dist/ssr';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/lib/dashboard-stats';
import { SiteSwitcher } from './site-switcher';

export function UtilityBar({
  websiteUrl,
  gscConnected,
  lastRefresh,
  websites,
  currentWebsiteId,
}: {
  websiteUrl: string;
  gscConnected: boolean;
  lastRefresh: Date | null;
  websites?: { id: string; url: string }[];
  currentWebsiteId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3">
      <div className="flex min-w-0 items-center gap-3">
        {websites && websites.length > 1 && currentWebsiteId ? (
          <SiteSwitcher websites={websites} currentWebsiteId={currentWebsiteId} />
        ) : (
          <span className="truncate font-mono text-sm font-medium text-foreground">{websiteUrl}</span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--dex-app-border-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {gscConnected ? (
                <CloudCheck size={12} weight="bold" className="text-[var(--dex-app-success)]" aria-hidden="true" />
              ) : (
                <CloudSlash size={12} weight="bold" className="text-[var(--dex-app-danger)]" aria-hidden="true" />
              )}
              {gscConnected ? 'Connected' : 'Not connected'}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {gscConnected ? 'Search Console connected' : 'Search Console not connected'}
          </TooltipContent>
        </Tooltip>
        {lastRefresh && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Last refresh {formatRelativeTime(lastRefresh)}
          </span>
        )}
      </div>
      <UserButton afterSignOutUrl="/" />
    </div>
  );
}
```

`websites`/`currentWebsiteId` are optional so any other caller of `UtilityBar` that doesn't yet pass them keeps rendering the plain-text site name exactly as before — a purely additive change.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/app-shell/utility-bar.tsx
git commit -m "$(cat <<'EOF'
feat: UtilityBar renders a site switcher when more than one website exists

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 13: Restructure `/dashboard` into `/dashboard/[websiteId]`

**Files:**
- Create: `src/app/dashboard/[websiteId]/page.tsx` (the current `dashboard/page.tsx`, modified)
- Modify: `src/app/dashboard/page.tsx` (replaced with a thin redirect)

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError` (Task 1); `CommandBar` (now requires `websiteId`, Task 7); `UtilityBar` (now accepts `websites`/`currentWebsiteId`, Task 12).
- Produces: the site-scoped dashboard page. No other task consumes this directly — it's a leaf.

This is the largest single-file task in the plan. Work from the current file's full content (328 lines) rather than reconstructing it from scratch — copy it to the new path, then apply exactly the edits below.

- [ ] **Step 1: Copy the current dashboard page to the new path**

```bash
mkdir -p "src/app/dashboard/[websiteId]"
cp src/app/dashboard/page.tsx "src/app/dashboard/[websiteId]/page.tsx"
```

- [ ] **Step 2: Edit `src/app/dashboard/[websiteId]/page.tsx` — resolve by param instead of the hard-coded lookup**

Change the imports at the top — replace:

```typescript
import { ensureCustomer, PENDING_WEBSITE_URL } from '@/lib/customer';
```

with:

```typescript
import { notFound } from 'next/navigation';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
```

Change the function signature and the resolution logic — replace:

```typescript
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { range?: string; tab?: string; actionId?: string };
}) {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  const { customer, website } = await ensureCustomer(userId, PENDING_WEBSITE_URL);
```

with:

```typescript
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: { websiteId: string };
  searchParams: { range?: string; tab?: string; actionId?: string };
}) {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  let customer, website, websites;
  try {
    ({ customer, website, websites } = await resolveWebsiteForRequest(userId, params.websiteId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) return notFound();
    throw err;
  }
```

Change the `UtilityBar` call — replace:

```tsx
      {siteSelected && (
        <UtilityBar
          websiteUrl={website.url}
          gscConnected={gscConnected}
          lastRefresh={latestScanJob?.completedAt ?? null}
        />
      )}
```

with:

```tsx
      {siteSelected && (
        <UtilityBar
          websiteUrl={website.url}
          gscConnected={gscConnected}
          lastRefresh={latestScanJob?.completedAt ?? null}
          websites={websites}
          currentWebsiteId={website.id}
        />
      )}
```

Change the "Scan now" form to carry the website id — replace:

```tsx
            <form action="/api/scan" method="post">
              <Button type="submit" variant="accent">
                Scan now
              </Button>
            </form>
```

with:

```tsx
            <form action="/api/scan" method="post">
              <input type="hidden" name="websiteId" value={website.id} />
              <Button type="submit" variant="accent">
                Scan now
              </Button>
            </form>
```

Change the `CommandBar` call — replace:

```tsx
              <div className="mt-4">
                <CommandBar />
              </div>
```

with:

```tsx
              <div className="mt-4">
                <CommandBar websiteId={website.id} />
              </div>
```

**No change needed for tab/range navigation.** `DashboardTabs` and `DateRangeSelect` (`src/components/dashboard/dashboard-tabs.tsx`, `src/components/dashboard/date-range-select.tsx`) both navigate via `router.push(\`?${params.toString()}\`, { scroll: false })` — a query-only relative push that Next.js resolves against the *current* pathname automatically. Once this page lives at `/dashboard/[websiteId]`, clicking a tab from `/dashboard/abc123` still lands on `/dashboard/abc123?tab=review` with zero code changes in either component. Do not touch these two files in this task.

- [ ] **Step 3: Replace `src/app/dashboard/page.tsx` with a thin redirect**

```tsx
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { resolveWebsiteForRequest } from '@/lib/customer';

export default async function DashboardRedirectPage() {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  const { website } = await resolveWebsiteForRequest(userId);
  redirect(`/dashboard/${website.id}`);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — this resolves the `CommandBar`/`UtilityBar` call-site mismatches carried since Tasks 7 and 12.

- [ ] **Step 5: Full regression + build**

Run: `npx vitest run`
Expected: PASS, full suite (no dashboard-page test exists to break, but this confirms nothing else regressed).

Run: `npx next build`
Expected: PASS. Confirm the build's route table shows both `/dashboard` and `/dashboard/[websiteId]`.

- [ ] **Step 6: Manual smoke check**

Run `npm run dev`, sign in, visit `/dashboard`. Confirm it redirects to `/dashboard/<some-id>` and renders exactly as before. This is a UI change — do not skip this manual check even though the automated gate passed.

- [ ] **Step 7: Commit**

```bash
git add "src/app/dashboard/[websiteId]/page.tsx" src/app/dashboard/page.tsx
git commit -m "$(cat <<'EOF'
feat: move the dashboard to /dashboard/[websiteId]

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 14: Restructure `/settings` — list, add, and connect websites

**Files:**
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest` (Task 1); `AutoExecuteToggle` (now requires `websiteId`, Task 10); `POST /api/websites` (Task 2); `/api/gsc/connect?websiteId=` (Task 3); `/api/gsc/select-site` with a `websiteId` field (Task 5).
- Produces: the restructured settings page. Leaf — nothing else consumes it.

No test file (page convention, same as Task 13 — verified via `next build` + manual smoke check).

- [ ] **Step 1: Write the page**

Replace the full contents of `src/app/settings/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest } from '@/lib/customer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AutoExecuteToggle } from '@/components/auto-execute-toggle';

export default async function SettingsPage() {
  const { userId } = auth();
  if (!userId) return null;

  const { websites } = await resolveWebsiteForRequest(userId);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Account settings</h1>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Websites</CardTitle>
          <CardDescription>
            Up to {websites.length < 3 ? 3 : websites.length} sites per client profile. Each one connects to its own
            Google Search Console property.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {websites.map((site) => (
            <div key={site.id} className="flex flex-col gap-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="truncate font-mono text-sm font-medium text-foreground">{site.url}</span>
                {site.gscRefreshToken ? (
                  <span className="text-xs text-[var(--dex-app-success)]">Search Console connected</span>
                ) : (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/gsc/connect?websiteId=${site.id}`}>Connect Search Console</a>
                  </Button>
                )}
              </div>

              {site.gscRefreshToken && site.url.includes('example-pending-setup.com') && (
                <form action="/api/gsc/select-site" method="post" className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="websiteId" value={site.id} />
                  <label htmlFor={`siteUrl-${site.id}`} className="text-sm text-muted-foreground">
                    Choose a verified property:
                  </label>
                  <input
                    id={`siteUrl-${site.id}`}
                    name="siteUrl"
                    type="url"
                    required
                    placeholder="https://your-verified-property.com"
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                  <Button type="submit" size="sm" variant="accent">
                    Save
                  </Button>
                </form>
              )}

              <AutoExecuteToggle initialEnabled={site.autoExecuteEnabled} websiteId={site.id} />
            </div>
          ))}

          <form action="/api/websites" method="post" className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <label htmlFor="newWebsiteUrl" className="text-sm font-medium text-foreground">
              Add a website:
            </label>
            <input
              id="newWebsiteUrl"
              name="url"
              type="url"
              required
              placeholder="https://example.com"
              className="min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            <Button type="submit" variant="accent">
              Add
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

**Note on the "Add" form:** `POST /api/websites` (Task 2) returns a JSON body, not a redirect — this plain `<form method="post">` will navigate the browser to whatever the fetch-free POST returns, which for a JSON API route means the browser renders the raw JSON. This is a real UX gap worth closing, but do it as a follow-up client-component wrapper (mirroring `ContentStudioShell`'s `handleGenerate` fetch pattern from the Content Studio milestone) rather than blocking this task — if you have time within this task, convert the "Add a website" form into a small client component (`AddWebsiteForm`) that `fetch()`s `POST /api/websites`, shows the returned error inline on failure, and calls `router.refresh()` on success instead of a plain form POST. If you don't have time, leave the plain form as written above and flag it as a concern in your report — do not silently ship a broken-feeling raw-JSON response without saying so.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Full regression + build**

Run: `npx vitest run`
Expected: PASS, full suite.

Run: `npx next build`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Run `npm run dev`, sign in, visit `/settings`. Confirm the Websites list renders, "Add a website" accepts a URL, and (if you built the `AddWebsiteForm` client-component upgrade) the new site appears without a raw-JSON page. This is a UI change — do not skip this check.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/page.tsx
# add src/components/settings/add-website-form.tsx here too if you built it
git commit -m "$(cat <<'EOF'
feat: list, add, and connect multiple websites on the settings page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 15: Milestone gate — full regression, build, checkpoint

**Files:** none created or modified beyond the checkpoint doc below.

**Interfaces:** none — this task verifies everything Tasks 1-14 produced works together.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, every prior test plus every test added in Tasks 1-6, 8-9 passing.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 3: Production build**

Run: `npx next build`
Expected: PASS. `/dashboard`, `/dashboard/[websiteId]`, `/api/websites` all listed in the build output.

- [ ] **Step 4: Update the durable progress doc**

Edit `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md` — this feature wasn't in the brief's original milestone list (it was triggered by a user-reported gap after Milestone D shipped), so add a short new entry noting it's done, with the commit range from Task 1 through Task 14, rather than trying to slot it into the existing numbered "Remaining" list.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "$(cat <<'EOF'
docs: mark multi-site support complete

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```
