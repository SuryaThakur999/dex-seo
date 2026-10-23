# Dex Week 1 Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-implementation amendment (2026-08-19):** the final whole-branch review (dispatched after all 8 tasks below were individually built and reviewed) found this plan had two real defects of its own, both fixed in commit `23ed39b` on top of the work below:
> 1. Task 4 Step 9 and Task 8 Step 2's reference code hardcode `websiteUrl` to a placeholder (`'https://example-pending-setup.com'`) with no task ever replacing it — this silently breaks the actual "Scan my site" deliverable for every real user (Google 403s on a non-existent Search Console property). Fixed by adding a `sites.list`-backed site picker (`src/app/api/gsc/select-site/route.ts`, dashboard three-state UI) after this plan shipped, not as part of it.
> 2. Task 5 Step 5/6's reference code uses the Clerk `userId` itself as the OAuth `state` parameter — a knowable, per-user-stable value, not real CSRF protection. Fixed post-hoc with a random nonce stored in a short-lived httpOnly cookie.
>
> Also: Task 2's "Interfaces" prose called `db` (from `src/lib/db.ts`) a "default export" — the code (both in this plan and as implemented) is actually a named export (`export const db`). Prose-only mismatch, never a code defect; noted here so it isn't miscopied into a future plan.
>
> Left as-is, judged acceptable for a Week 1 MVP: Search Console's `searchanalytics.query` (used by `listIndexedPages`) only returns pages that received search impressions in the last 28 days, not the customer's full indexed-page list — a page with zero impressions and a broken meta description is invisible to this scan. Week 2's Growth Brain design should account for this gap rather than assume the Week 1 crawl is exhaustive.

**Goal:** Stand up the Dex Phase 1 MVP scaffold — Next.js app, Clerk auth, Prisma/Postgres schema, GSC OAuth (read-only), and a public-page crawler — ending with a working "Scan my site" flow a signed-in customer can trigger from `/dashboard`.

**Architecture:** Next.js 14 App Router (TypeScript) hosted for local dev / later Vercel deploy. Clerk owns auth/session. Prisma + Postgres (Neon) is the single datastore. A Google OAuth2 flow (via `googleapis`) captures a read-only Search Console refresh token, encrypted at rest. A crawler (`cheerio` + `robots-parser`) reads each indexed page's current title/meta description. No LLM call, no GrowthGuard, no Review UI yet — those are Week 2/3.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma 5, Postgres (Neon), @clerk/nextjs, googleapis, cheerio, robots-parser, Vitest.

## Global Constraints

- Stack is fixed: Next.js 14 App Router + TypeScript + Vercel target + Postgres (Neon) + Prisma + Clerk + OpenAI. (ADR 0001)
- Auth is bought, not built — no hand-rolled password/session/OAuth-for-login logic. Clerk only. (ADR 0001)
- GSC OAuth requests `https://www.googleapis.com/auth/webmasters.readonly` only — never a write scope. (spec Section 5)
- No CMS write-back API of any kind this phase. (ADR 0002)
- `Customer.autoExecuteEnabled` defaults to `false`; nothing in Week 1 code path may set it `true` automatically. (ADR 0003)
- Secrets (`DATABASE_URL`, Clerk keys, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `ENCRYPTION_KEY`) live only in `.env.local` / host env vars, never committed. `.gitignore` must exclude all `.env*` except `.env.example` before any task that introduces a real secret. (spec Section 7)
- Crawler must respect `robots.txt` and rate-limit requests per target domain. (spec Section 5)
- No `Learning Engine` tables, no `GuardResult` scoring logic, no OpenAI calls, no Review UI, no Shopify/WooCommerce — all explicitly Week 2/3 or later. Do not pull any of it forward. (spec Section 8)

---

## File Structure

```
package.json
tsconfig.json
next.config.mjs
vitest.config.ts
.gitignore
.env.example
prisma/
  schema.prisma
src/
  app/
    layout.tsx
    page.tsx
    globals.css
    sign-in/[[...sign-in]]/page.tsx
    sign-up/[[...sign-up]]/page.tsx
    dashboard/page.tsx
    api/
      gsc/connect/route.ts
      gsc/callback/route.ts
      scan/route.ts
  middleware.ts
  lib/
    db.ts
    customer.ts
    crypto.ts
    google-oauth.ts
    gsc-client.ts
    crawler.ts
```

One responsibility per `lib` file: `db.ts` is the Prisma singleton, `customer.ts` provisions/reads the `Customer` row for the signed-in Clerk user, `crypto.ts` is the only place refresh tokens get encrypted/decrypted, `google-oauth.ts` builds the consent URL and exchanges codes for tokens, `gsc-client.ts` turns a refresh token into a list of indexed page URLs, `crawler.ts` turns a URL into `{title, metaDescription}` while respecting robots.txt and per-domain rate limits.

---

### Task 1: Project Scaffold & Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `next-env.d.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`

**Interfaces:**
- Produces: a buildable Next.js app at repo root; `npm run dev`, `npm run build`, `npm test` all work from here on.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "dex-app",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@clerk/nextjs": "^5.2.0",
    "@prisma/client": "^5.14.0",
    "cheerio": "^1.0.0-rc.12",
    "googleapis": "^140.0.0",
    "next": "^14.2.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "robots-parser": "^3.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "prisma": "^5.14.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 4: Write `next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: { environment: 'node' },
});
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules
.next
.env
.env.local
.env*.local
!.env.example
```

- [ ] **Step 7: Write `.env.example`**

```
DATABASE_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gsc/callback
ENCRYPTION_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 8: Write `src/app/globals.css`**

```css
:root {
  color-scheme: light;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
```

- [ ] **Step 9: Write `src/app/layout.tsx`**

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Dex',
  description: 'Internal codename — see docs/adr/0005',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 10: Write `src/app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main>
      <h1>Dex</h1>
      <p>Phase 1 MVP scaffold.</p>
    </main>
  );
}
```

- [ ] **Step 11: Install and verify build**

Run: `npm install`
Expected: dependencies install with no errors (network access to the npm registry required — if this session's sandbox blocks it, rerun with elevated network permission).

Run: `npm run build`
Expected: `✓ Compiled successfully` with routes `/` listed.

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.json next.config.mjs next-env.d.ts vitest.config.ts .gitignore .env.example src/app/layout.tsx src/app/page.tsx src/app/globals.css package-lock.json
git commit -m "chore: scaffold Next.js 14 app (TypeScript, App Router)"
```

---

### Task 2: Prisma Schema & Postgres Connection

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`
- Test: none (schema/client wiring verified via `prisma generate` + `prisma migrate dev`, which need a live `DATABASE_URL`)

**Interfaces:**
- Produces: `db` (default export from `src/lib/db.ts`), a `PrismaClient` instance; `Customer`, `Action`, `GuardResult` Prisma models matching the spec's schema exactly.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Customer {
  id                 String   @id @default(cuid())
  clerkUserId        String   @unique
  websiteUrl         String
  gscRefreshToken    String?
  plan               String   @default("free")
  autoExecuteEnabled Boolean  @default(false)
  actions            Action[]
}

model Action {
  id           String       @id @default(cuid())
  customerId   String
  customer     Customer     @relation(fields: [customerId], references: [id])
  pageUrl      String
  actionType   String
  currentValue String?
  draftContent String
  aiDisclosure Boolean      @default(true)
  guardResult  GuardResult?
  status       String       @default("pending")
  tokenCost    Int?
  createdAt    DateTime     @default(now())
  decidedAt    DateTime?
}

model GuardResult {
  id        String @id @default(cuid())
  actionId  String @unique
  action    Action @relation(fields: [actionId], references: [id])
  outcome   String
  checksRun Json
  reasoning String
}
```

- [ ] **Step 2: Write `src/lib/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
```

- [ ] **Step 3: Set `DATABASE_URL` and generate the client**

Copy `.env.example` to `.env.local`, fill in a real Neon Postgres connection string for `DATABASE_URL`.

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Run the initial migration**

Run: `npx prisma migrate dev --name init`
Expected: migration file created under `prisma/migrations/`, applied to the Neon database, `Customer`/`Action`/`GuardResult` tables exist.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/db.ts
git commit -m "feat: add Prisma schema (Customer/Action/GuardResult) and Postgres connection"
```

---

### Task 3: Encryption Utility for Refresh Tokens

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `src/lib/crypto.test.ts`

**Interfaces:**
- Consumes: `process.env.ENCRYPTION_KEY` (64-char hex string = 32 bytes).
- Produces: `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`, used by Task 5's OAuth callback before writing `Customer.gscRefreshToken`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crypto.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt } from './crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
});

describe('crypto', () => {
  it('round-trips a plaintext string', () => {
    const ciphertext = encrypt('a-refresh-token-value');
    expect(ciphertext).not.toBe('a-refresh-token-value');
    expect(decrypt(ciphertext)).toBe('a-refresh-token-value');
  });

  it('produces different ciphertext for the same plaintext on repeated calls', () => {
    const a = encrypt('same-input');
    const b = encrypt('same-input');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/crypto.test.ts`
Expected: FAIL — `Cannot find module './crypto'` (file doesn't exist yet).

- [ ] **Step 3: Write `src/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

// Format: iv(hex):authTag(hex):ciphertext(hex) — a fresh random iv per call
// is why two calls with the same plaintext never match.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/crypto.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts src/lib/crypto.test.ts
git commit -m "feat: add AES-256-GCM encrypt/decrypt for GSC refresh tokens"
```

---

### Task 4: Clerk Auth Wiring & Customer Provisioning

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/middleware.ts`
- Create: `src/app/sign-in/[[...sign-in]]/page.tsx`
- Create: `src/app/sign-up/[[...sign-up]]/page.tsx`
- Create: `src/app/dashboard/page.tsx`
- Create: `src/lib/customer.ts`
- Test: `src/lib/customer.test.ts`

**Interfaces:**
- Consumes: `db` from `src/lib/db.ts` (Task 2).
- Produces: `ensureCustomer(clerkUserId: string, websiteUrl: string): Promise<Customer>`, used by `dashboard/page.tsx` and later by `api/scan/route.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/customer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ensureCustomer } from './customer';
import { db } from './db';

vi.mock('./db', () => ({
  db: {
    customer: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('ensureCustomer', () => {
  it('returns the existing customer if one exists for the Clerk user', async () => {
    const existing = { id: 'c1', clerkUserId: 'user_1', websiteUrl: 'https://a.com' };
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

    const result = await ensureCustomer('user_1', 'https://a.com');

    expect(result).toBe(existing);
    expect(db.customer.create).not.toHaveBeenCalled();
  });

  it('creates a customer row if none exists yet', async () => {
    const created = { id: 'c2', clerkUserId: 'user_2', websiteUrl: 'https://b.com' };
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.customer.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    const result = await ensureCustomer('user_2', 'https://b.com');

    expect(result).toBe(created);
    expect(db.customer.create).toHaveBeenCalledWith({
      data: { clerkUserId: 'user_2', websiteUrl: 'https://b.com' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/customer.test.ts`
Expected: FAIL — `Cannot find module './customer'`

- [ ] **Step 3: Write `src/lib/customer.ts`**

```ts
import { db } from './db';
import type { Customer } from '@prisma/client';

export async function ensureCustomer(clerkUserId: string, websiteUrl: string): Promise<Customer> {
  const existing = await db.customer.findUnique({ where: { clerkUserId } });
  if (existing) return existing;
  return db.customer.create({ data: { clerkUserId, websiteUrl } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/customer.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `src/middleware.ts`**

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/api/gsc(.*)', '/api/scan(.*)']);

export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) auth().protect();
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)'],
};
```

- [ ] **Step 6: Modify `src/app/layout.tsx` to wrap the app in `ClerkProvider`**

```tsx
import './globals.css';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';

export const metadata = {
  title: 'Dex',
  description: 'Internal codename — see docs/adr/0005',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 7: Write `src/app/sign-in/[[...sign-in]]/page.tsx`**

```tsx
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return <SignIn />;
}
```

- [ ] **Step 8: Write `src/app/sign-up/[[...sign-up]]/page.tsx`**

```tsx
import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return <SignUp />;
}
```

- [ ] **Step 9: Write `src/app/dashboard/page.tsx`**

```tsx
import { auth, currentUser } from '@clerk/nextjs/server';
import { ensureCustomer } from '@/lib/customer';

export default async function DashboardPage() {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  const user = await currentUser();
  const websiteUrl = user?.primaryEmailAddress?.emailAddress
    ? `https://example-pending-setup.com`
    : `https://example-pending-setup.com`;

  const customer = await ensureCustomer(userId, websiteUrl);

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Customer ID: {customer.id}</p>
      <p>GSC connected: {customer.gscRefreshToken ? 'yes' : 'no'}</p>
    </main>
  );
}
```

- [ ] **Step 10: Set Clerk env vars and verify locally**

Fill `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local` from a Clerk dashboard project.

Run: `npm run dev`, visit `http://localhost:3000/dashboard`
Expected: redirected to `/sign-in`; after signing in, redirected back to `/dashboard` showing a `Customer ID` and `GSC connected: no`.

- [ ] **Step 11: Commit**

```bash
git add src/middleware.ts src/app/layout.tsx src/app/sign-in src/app/sign-up src/app/dashboard src/lib/customer.ts src/lib/customer.test.ts
git commit -m "feat: wire Clerk auth, protect app routes, provision Customer on first dashboard visit"
```

---

### Task 5: Google OAuth Flow for GSC (Read-Only)

**Files:**
- Create: `src/lib/google-oauth.ts`
- Create: `src/app/api/gsc/connect/route.ts`
- Create: `src/app/api/gsc/callback/route.ts`
- Test: `src/lib/google-oauth.test.ts`

**Interfaces:**
- Consumes: `encrypt` from `src/lib/crypto.ts` (Task 3), `ensureCustomer`/`db` (Task 2/4).
- Produces: `buildAuthUrl(state: string): string` and `exchangeCodeForRefreshToken(code: string): Promise<string>`, used by the two route handlers below and by Task 6's `gsc-client.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/google-oauth.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildAuthUrl } from './google-oauth';

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/gsc/callback';
});

describe('buildAuthUrl', () => {
  it('requests only the read-only webmasters scope', () => {
    const url = buildAuthUrl('some-state');
    expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fwebmasters.readonly');
  });

  it('includes the provided state parameter', () => {
    const url = buildAuthUrl('some-state');
    expect(url).toContain('state=some-state');
  });

  it('requests offline access so a refresh token is returned', () => {
    const url = buildAuthUrl('some-state');
    expect(url).toContain('access_type=offline');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/google-oauth.test.ts`
Expected: FAIL — `Cannot find module './google-oauth'`

- [ ] **Step 3: Write `src/lib/google-oauth.ts`**

```ts
import { google } from 'googleapis';

const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function buildAuthUrl(state: string): string {
  return client().generateAuthUrl({
    access_type: 'offline',
    scope: [READONLY_SCOPE],
    state,
    prompt: 'consent',
  });
}

export async function exchangeCodeForRefreshToken(code: string): Promise<string> {
  const { tokens } = await client().getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token — user may need to revoke prior access and reconnect');
  }
  return tokens.refresh_token;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/google-oauth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write `src/app/api/gsc/connect/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { buildAuthUrl } from '@/lib/google-oauth';

export async function GET() {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  redirect(buildAuthUrl(userId));
}
```

- [ ] **Step 6: Write `src/app/api/gsc/callback/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForRefreshToken } from '@/lib/google-oauth';
import { encrypt } from '@/lib/crypto';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || state !== userId) {
    return new Response('Invalid OAuth callback', { status: 400 });
  }

  const refreshToken = await exchangeCodeForRefreshToken(code);

  await db.customer.update({
    where: { clerkUserId: userId },
    data: { gscRefreshToken: encrypt(refreshToken) },
  });

  return NextResponse.redirect(new URL('/dashboard', req.url));
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/google-oauth.ts src/lib/google-oauth.test.ts src/app/api/gsc
git commit -m "feat: add Google OAuth flow for read-only Search Console access"
```

---

### Task 6: GSC Client — List Indexed Pages

**Files:**
- Create: `src/lib/gsc-client.ts`
- Test: `src/lib/gsc-client.test.ts`

**Interfaces:**
- Consumes: a decrypted refresh token (caller decrypts via `decrypt` from `src/lib/crypto.ts` before calling).
- Produces: `listIndexedPages(refreshToken: string, siteUrl: string): Promise<string[]>`, used by Task 8's `api/scan/route.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/gsc-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { extractPageUrls } from './gsc-client';

describe('extractPageUrls', () => {
  it('pulls the page dimension out of a Search Console query response', () => {
    const response = {
      rows: [
        { keys: ['https://example.com/a'], clicks: 3, impressions: 40 },
        { keys: ['https://example.com/b'], clicks: 0, impressions: 12 },
      ],
    };
    expect(extractPageUrls(response)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('returns an empty array when there are no rows', () => {
    expect(extractPageUrls({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gsc-client.test.ts`
Expected: FAIL — `Cannot find module './gsc-client'`

- [ ] **Step 3: Write `src/lib/gsc-client.ts`**

```ts
import { google, searchconsole_v1 } from 'googleapis';

type SearchAnalyticsResponse = searchconsole_v1.Schema$SearchAnalyticsQueryResponse;

export function extractPageUrls(response: SearchAnalyticsResponse): string[] {
  return (response.rows ?? []).map((row) => row.keys?.[0]).filter((url): url is string => Boolean(url));
}

export async function listIndexedPages(refreshToken: string, siteUrl: string): Promise<string[]> {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: refreshToken });

  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const { data } = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      dimensions: ['page'],
      rowLimit: 100,
    },
  });

  return extractPageUrls(data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gsc-client.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/gsc-client.ts src/lib/gsc-client.test.ts
git commit -m "feat: add Search Console client to list a customer's indexed pages"
```

---

### Task 7: Crawler — Robots-Aware, Rate-Limited Page Fetch

**Files:**
- Create: `src/lib/crawler.ts`
- Test: `src/lib/crawler.test.ts`

**Interfaces:**
- Produces: `isAllowedByRobots(url: string, fetchRobotsTxt: (robotsUrl: string) => Promise<string>): Promise<boolean>`, `parsePageMeta(html: string): { title: string | null; metaDescription: string | null }`, `throttle(hostname: string, minIntervalMs: number): Promise<void>`, `fetchPageMeta(url: string, fetchImpl?: typeof fetch): Promise<{ title: string | null; metaDescription: string | null }>` — used by Task 8's `api/scan/route.ts`.
- All network-touching functions take an injectable fetch function (defaulting to global `fetch`) so tests never make real HTTP calls.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crawler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isAllowedByRobots, parsePageMeta, throttle } from './crawler';

describe('parsePageMeta', () => {
  it('extracts the title and meta description from HTML', () => {
    const html = `
      <html><head>
        <title>Example Page</title>
        <meta name="description" content="An example page for testing.">
      </head></html>
    `;
    expect(parsePageMeta(html)).toEqual({
      title: 'Example Page',
      metaDescription: 'An example page for testing.',
    });
  });

  it('returns nulls when title or meta description are missing', () => {
    expect(parsePageMeta('<html><head></head></html>')).toEqual({
      title: null,
      metaDescription: null,
    });
  });
});

describe('isAllowedByRobots', () => {
  it('disallows a path blocked in robots.txt', async () => {
    const fetchRobotsTxt = vi.fn().mockResolvedValue('User-agent: *\nDisallow: /admin');
    const allowed = await isAllowedByRobots('https://example.com/admin/page', fetchRobotsTxt);
    expect(allowed).toBe(false);
  });

  it('allows a path not blocked in robots.txt', async () => {
    const fetchRobotsTxt = vi.fn().mockResolvedValue('User-agent: *\nDisallow: /admin');
    const allowed = await isAllowedByRobots('https://example.com/blog/post', fetchRobotsTxt);
    expect(allowed).toBe(true);
  });
});

describe('throttle', () => {
  it('waits at least minIntervalMs between two calls for the same hostname', async () => {
    const start = Date.now();
    await throttle('example.com', 50);
    await throttle('example.com', 50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/crawler.test.ts`
Expected: FAIL — `Cannot find module './crawler'`

- [ ] **Step 3: Write `src/lib/crawler.ts`**

```ts
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';

const USER_AGENT = 'DexBot/0.1';

export function parsePageMeta(html: string): { title: string | null; metaDescription: string | null } {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null;
  return { title, metaDescription };
}

export async function isAllowedByRobots(
  url: string,
  fetchRobotsTxt: (robotsUrl: string) => Promise<string>
): Promise<boolean> {
  const { origin } = new URL(url);
  const robotsUrl = `${origin}/robots.txt`;
  const robotsTxt = await fetchRobotsTxt(robotsUrl).catch(() => '');
  const robots = robotsParser(robotsUrl, robotsTxt);
  return robots.isAllowed(url, USER_AGENT) ?? true;
}

// In-memory only: correct within one scan request's loop over a customer's
// pages (same process), not across separate serverless invocations.
const lastFetchAt = new Map<string, number>();

export async function throttle(hostname: string, minIntervalMs: number): Promise<void> {
  const last = lastFetchAt.get(hostname) ?? 0;
  const wait = Math.max(0, last + minIntervalMs - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastFetchAt.set(hostname, Date.now());
}

export async function fetchPageMeta(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ title: string | null; metaDescription: string | null }> {
  const { hostname } = new URL(url);

  const allowed = await isAllowedByRobots(url, async (robotsUrl) => {
    const res = await fetchImpl(robotsUrl, { headers: { 'User-Agent': USER_AGENT } });
    return res.ok ? res.text() : '';
  });
  if (!allowed) {
    return { title: null, metaDescription: null };
  }

  await throttle(hostname, 1000);
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return { title: null, metaDescription: null };
  return parsePageMeta(await res.text());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/crawler.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/crawler.ts src/lib/crawler.test.ts
git commit -m "feat: add robots-aware, rate-limited crawler for reading page title/meta description"
```

---

### Task 8: Wire the "Scan My Site" Flow End-to-End

**Files:**
- Create: `src/app/api/scan/route.ts`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `ensureCustomer`/`db` (Task 4), `decrypt` (Task 3), `listIndexedPages` (Task 6), `fetchPageMeta` (Task 7).
- Produces: `POST /api/scan` — the first fully wired Week 1 deliverable a signed-in customer can click through.

- [ ] **Step 1: Write `src/app/api/scan/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { listIndexedPages } from '@/lib/gsc-client';
import { fetchPageMeta } from '@/lib/crawler';

export async function POST() {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer?.gscRefreshToken) {
    return NextResponse.json({ error: 'Connect Google Search Console first' }, { status: 400 });
  }

  const refreshToken = decrypt(customer.gscRefreshToken);
  const pageUrls = await listIndexedPages(refreshToken, customer.websiteUrl);

  const pages = [];
  for (const url of pageUrls) {
    const meta = await fetchPageMeta(url);
    pages.push({ url, ...meta });
  }

  return NextResponse.json({ pages });
}
```

- [ ] **Step 2: Modify `src/app/dashboard/page.tsx` to add Connect GSC and Scan controls**

```tsx
import { auth, currentUser } from '@clerk/nextjs/server';
import { ensureCustomer } from '@/lib/customer';

export default async function DashboardPage() {
  const { userId } = auth();
  if (!userId) return null;

  await currentUser();
  const customer = await ensureCustomer(userId, 'https://example-pending-setup.com');

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Customer ID: {customer.id}</p>
      <p>GSC connected: {customer.gscRefreshToken ? 'yes' : 'no'}</p>
      {!customer.gscRefreshToken && <a href="/api/gsc/connect">Connect Google Search Console</a>}
      {customer.gscRefreshToken && (
        <form action="/api/scan" method="post">
          <button type="submit">Scan my site</button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Manual end-to-end verification**

Run: `npm run dev`

1. Visit `/dashboard`, sign in — see "GSC connected: no" and a "Connect Google Search Console" link.
2. Click it, complete Google's consent screen for a site you own in Search Console — redirected back to `/dashboard`, now "GSC connected: yes" with a "Scan my site" button.
3. Click "Scan my site" — `POST /api/scan` returns JSON `{ pages: [{ url, title, metaDescription }, ...] }` for your indexed pages.

Expected: no unhandled server errors in any step; pages list reflects real crawled titles/meta descriptions for at least one real indexed URL.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/scan src/app/dashboard/page.tsx
git commit -m "feat: wire GSC connect + scan into dashboard, completing Week 1 scaffold"
```
