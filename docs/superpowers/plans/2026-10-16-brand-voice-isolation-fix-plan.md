# Brand-Voice Isolation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding a website for a different company no longer shows the first company's brand voice, audience, claims, or restricted wording in Studio or Settings. A customer can run multiple separate companies in one workspace, each with its own `ClientProfile` and its own set of websites.

**Architecture:** The bug is a single choke point: `resolveWebsiteForRequest` (`src/lib/customer.ts`) only ever looks inside the customer's *default* `ClientProfile` when resolving a `websiteId`, and `POST /api/websites` always attaches a new site to `defaultWebsite.clientProfileId`. Every brand-scoped read (Studio, Settings, ProfileSuggestions, CompetitorEntity, ContentRecommendation) already keys correctly off `clientProfileId` — the fix is making website resolution and website creation profile-aware, not touching any of those reads.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest + Testing Library.

## Global Constraints

- No new tables. `ClientProfile`/`Website`/`ProfileSuggestion`/`ResearchJob`/`CompetitorEntity`/`ContentRecommendation` schemas are otherwise unchanged.
- `Customer.maxClientProfiles` default 1 → 3, with a data migration setting existing customers to 3. Human (Surya) has already approved this exact change in the dispatch message — write the migration for review, do not apply it to production (standing rule: production migrations stay with the human).
- Past `ContentPiece` rows never get their `clientProfileId` rewritten by the split-company migration action — preserves real history.
- Tests first for every task. Tenant isolation (a website/profile/suggestion belonging to another customer must be rejected, never silently returned) is tested in every task that touches an API boundary.
- Tier 2 design rule applies to the add-website choice UI and the Settings company switcher: six-skill receipts (`emil-design-eng`, `apple-design`, `ui-ux-pro-max`, `ui-styling`, `soft-skill`, `impeccable`) in the done report; 320/768/1280px screenshots are blocked by the standing Clerk-sandbox gap in this environment — noted explicitly, not skipped silently.
- No invented company names: a new `ClientProfile.name` is always derived from the real website host (`normalizeSiteUrl`), never a fabricated brand name.

## Known gap, flagged non-blocking (per the "Overview error-state" precedent in the dashboard-IA dispatch)

`CompetitorEntity` has **no `websiteId` column** — it's keyed only by `clientProfileId` (see `prisma/schema.prisma`). The dispatch's migration-action design says "Make this its own company" moves the website's `ProfileSuggestion`/`ResearchJob`/`CompetitorEntity`/`ContentRecommendation` rows. `ProfileSuggestion`, `ResearchJob`, and `ContentRecommendation` all have a `websiteId` to select by; `CompetitorEntity` does not, so there is no principled way to tell which competitor rows "belong" to the one website being split out of a profile that may have other websites too. Task 7 below leaves `CompetitorEntity` rows with the original profile and documents this in code — building to spec as written for the three row types that can actually be scoped by website, not inventing a partition rule for the one type that can't. Non-blocking; flagged in the plan-hash reply for visibility.

---

### Task 1: Schema migration — `maxClientProfiles` default 1 → 3

**Files:**
- Modify: `prisma/schema.prisma:28` (`maxClientProfiles Int @default(1)` → `@default(3)`)
- Create: `prisma/migrations/20261016120000_max_client_profiles_default_3/migration.sql`

**Interfaces:**
- Produces: every `Customer` row (new and existing) has `maxClientProfiles >= 3`.

- [ ] **Step 1: Edit the schema default**

```prisma
maxClientProfiles Int               @default(3)
```

- [ ] **Step 2: Write the migration SQL by hand** (column-default-only change + one-time backfill, no destructive step)

```sql
-- prisma/migrations/20261016120000_max_client_profiles_default_3/migration.sql
ALTER TABLE "Customer" ALTER COLUMN "maxClientProfiles" SET DEFAULT 3;
UPDATE "Customer" SET "maxClientProfiles" = 3 WHERE "maxClientProfiles" < 3;
```

- [ ] **Step 3: No live DB in this environment to run `prisma migrate diff`** — hand-written in the same format as the existing `prisma/migrations/20261014150000_research_intelligence_v1/` migration (checked before writing this one). Do not run `prisma migrate deploy` — stays with the human, same as every migration this session.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261016120000_max_client_profiles_default_3/
git commit -m "feat(brand-voice-isolation): raise default maxClientProfiles 1 -> 3"
```

---

### Task 2: `resolveWebsiteForRequest` resolves a website's real owning profile

**Files:**
- Modify: `src/lib/customer.ts:57-85`
- Test: `src/lib/customer.test.ts` (new `describe('resolveWebsiteForRequest')` block)

**Interfaces:**
- Consumes: `db.customer`, `db.clientProfile`, `db.website` (Prisma).
- Produces: `resolveWebsiteForRequest(clerkUserId: string, websiteId?: string, clientProfileId?: string): Promise<{ customer: Customer; website: Website; websites: Website[] }>` — same signature as today. `website` now resolves correctly regardless of which of the customer's `ClientProfile`s owns it. `websites` now lists **every** website the customer owns across **every** `ClientProfile` (ordered by `createdAt` ascending), not just the resolved profile's — this is what lets a switcher list every company's sites in one dropdown (Task 4). Every existing caller that destructures only `{ website }` or `{ customer, website }` is unaffected; callers that use `websites` for same-company sibling logic (Task 5) now explicitly filter by `clientProfileId` themselves instead of relying on `websites` being pre-scoped.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/customer.test.ts -- add below the existing ensureCustomer tests
import { resolveWebsiteForRequest, WebsiteNotFoundError } from './customer';

describe('resolveWebsiteForRequest', () => {
  const customer = { id: 'cust_1', clerkUserId: 'user_1' };
  const defaultProfile = { id: 'cp_default', customerId: 'cust_1', isDefault: true };
  const secondProfile = { id: 'cp_second', customerId: 'cust_1', isDefault: false };
  const defaultSite = { id: 'site_default', clientProfileId: 'cp_default', url: 'https://a.test', createdAt: new Date('2026-01-01') };
  const secondSite = { id: 'site_second', clientProfileId: 'cp_second', url: 'https://b.test', createdAt: new Date('2026-02-01') };

  function mockDb() {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ ...customer, clientProfiles: [{ ...defaultProfile, websites: [defaultSite] }] });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockImplementation(async ({ where }: any) =>
      where.id === 'cp_second' ? { ...secondProfile, websites: [secondSite] } : { ...defaultProfile, websites: [defaultSite] }
    );
    (db.website.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.website.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([defaultSite, secondSite]);
  }

  it('resolves a websiteId owned by a NON-default client profile instead of assuming default', async () => {
    mockDb();
    (db.website.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ clientProfileId: 'cp_second' });
    const result = await resolveWebsiteForRequest('user_1', 'site_second');
    expect(result.website).toEqual(secondSite);
  });

  it('rejects a websiteId belonging to a different customer entirely (tenant isolation)', async () => {
    mockDb();
    (db.website.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(resolveWebsiteForRequest('user_1', 'someone_elses_site')).rejects.toBeInstanceOf(WebsiteNotFoundError);
  });

  it('lists every website across every one of the customer\'s client profiles, not just the resolved one', async () => {
    mockDb();
    const result = await resolveWebsiteForRequest('user_1');
    expect(result.websites.map(w => w.id).sort()).toEqual(['site_default', 'site_second']);
  });

  it('still defaults to the default profile\'s site when no websiteId is given', async () => {
    mockDb();
    const result = await resolveWebsiteForRequest('user_1');
    expect(result.website).toEqual(defaultSite);
  });

  it('an explicit clientProfileId still wins over websiteId-based profile lookup', async () => {
    mockDb();
    const result = await resolveWebsiteForRequest('user_1', 'site_second', 'cp_second');
    expect(db.website.findFirst).not.toHaveBeenCalled();
    expect(result.website).toEqual(secondSite);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/customer.test.ts`
Expected: FAIL — current code only ever looks in the default profile, so the non-default-profile resolution and cross-profile listing tests fail.

- [ ] **Step 3: Implement**

```typescript
export async function resolveWebsiteForRequest(
  clerkUserId: string,
  websiteId?: string,
  clientProfileId?: string
): Promise<{ customer: Customer; website: Website; websites: Website[] }> {
  const { customer, website: defaultWebsite } = await ensureCustomer(clerkUserId, PENDING_WEBSITE_URL);

  // A websiteId can belong to ANY of this customer's client profiles, not just the
  // default one -- a customer running more than one company picks a specific site
  // across any of them. Resolve its real owning profile first instead of assuming
  // default, then treat it exactly like an explicit clientProfileId from here on.
  if (websiteId && !clientProfileId) {
    const owned = await db.website.findFirst({
      where: { id: websiteId, clientProfile: { customerId: customer.id } },
      select: { clientProfileId: true },
    });
    if (!owned) throw new WebsiteNotFoundError(`Website ${websiteId} not found on this workspace.`);
    clientProfileId = owned.clientProfileId;
  }

  const profile = await db.clientProfile.findFirst({
    where: { customerId: customer.id, ...(clientProfileId ? { id: clientProfileId } : { isDefault: true }) },
    include: { websites: { orderBy: { createdAt: 'asc' } } },
  });
  if (clientProfileId && !profile?.websites.length) {
    throw new WebsiteNotFoundError('Client profile has no accessible website.');
  }
  const profileWebsites = profile?.websites ?? [defaultWebsite];

  // Every site switcher across the app lists every website this customer owns, across
  // every company, not just the one currently selected -- that's what lets switching
  // between companies happen from the same dropdown (Settings, Task 4).
  const allWebsites = await db.website.findMany({
    where: { clientProfile: { customerId: customer.id } },
    orderBy: { createdAt: 'asc' },
  });
  const websites = allWebsites.length ? allWebsites : profileWebsites;

  if (!websiteId) return { customer, website: profileWebsites[0] ?? defaultWebsite, websites };

  const website = profileWebsites.find((w) => w.id === websiteId);
  if (!website) {
    throw new WebsiteNotFoundError(`Website ${websiteId} not found on this workspace.`);
  }
  return { customer, website, websites };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/customer.test.ts`
Expected: PASS, all tests green including the existing `ensureCustomer` block (unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/customer.ts src/lib/customer.test.ts
git commit -m "fix(brand-voice-isolation): resolve a website's real owning client profile, not just default"
```

---

### Task 3: `SiteSwitcher` shows each website's own company name

**Files:**
- Modify: `src/components/app-shell/site-switcher.tsx`
- Test: `src/components/app-shell/site-switcher.test.tsx` (new)

**Interfaces:**
- Produces: `SiteSwitcher({ websites, currentWebsiteId, profileName, hrefPattern })` where each item of `websites` may now carry its own optional `profileName` (per-item), falling back to the single `profileName` prop when a given item doesn't carry one — so `content-studio-shell.tsx` and `utility-bar.tsx` (single global `profileName` for a single-company account) need zero changes.

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/app-shell/site-switcher.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { SiteSwitcher } from './site-switcher';

describe('SiteSwitcher — per-website company name', () => {
  it('shows each website\'s own company name in the list, not the globally selected one', () => {
    render(
      <SiteSwitcher
        websites={[
          { id: 'a', url: 'https://a.test', profileName: 'Acme' },
          { id: 'b', url: 'https://b.test', profileName: 'Beta Co' },
        ]}
        currentWebsiteId="a"
        profileName="Acme"
        hrefPattern="/settings?websiteId={id}"
      />,
    );
    expect(screen.getByText('Beta Co')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/app-shell/site-switcher.test.tsx`
Expected: FAIL — current component renders only the single global `profileName` for every item.

- [ ] **Step 3: Implement**

```typescript
export function SiteSwitcher({
  websites,
  currentWebsiteId,
  profileName,
  hrefPattern = '/dashboard/{id}',
}: {
  websites: { id: string; url: string; profileName?: string }[];
  currentWebsiteId: string;
  profileName?: string;
  hrefPattern?: string;
}) {
  const router = useRouter();
  const currentWebsite = websites.find((site) => site.id === currentWebsiteId);
  const currentLabel = currentWebsite?.profileName ?? profileName;

  return (
    <Select value={currentWebsiteId} onValueChange={(id) => router.push(hrefPattern.replace('{id}', encodeURIComponent(id)))}>
      <SelectTrigger aria-label="Switch website" className="min-w-0 max-w-[160px] border-[var(--dex-app-border-strong)] text-left shadow-none data-[size=default]:h-11 sm:max-w-[260px]">
        <SelectValue className="min-w-0">
          <span className="block min-w-0">
            {currentLabel && <span className="block truncate text-xs font-medium">{currentLabel}</span>}
            <span className="block truncate font-mono text-xs text-muted-foreground">{currentWebsite?.url}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="max-w-[calc(100vw-2rem)]">
        {websites.map((site) => {
          const label = site.profileName ?? profileName;
          return (
            <SelectItem key={site.id} value={site.id} textValue={`${label ?? ''} ${site.url}`} className="min-h-11 [&>span:last-child]:min-w-0">
              <span className="block min-w-0">
                {label && <span className="block truncate text-xs font-medium">{label}</span>}
                <span className="block truncate font-mono text-xs text-muted-foreground">{site.url}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/app-shell/site-switcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/app-shell/site-switcher.tsx src/components/app-shell/site-switcher.test.tsx
git commit -m "feat(brand-voice-isolation): SiteSwitcher shows each website's own company name"
```

---

### Task 4: Settings page wires the cross-company website list and the new copy

**Files:**
- Modify: `src/app/settings/page.tsx:93-101`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest` (Task 2), `SiteSwitcher` (Task 3).
- Produces: no new exports — server component page; this repo has no test file for any `page.tsx` today (logic lives in, and is tested at, the `lib`/component layer).

- [ ] **Step 1: No new failing test here** — Task 2 and Task 3's tests already prove the underlying behavior this step wires together.

- [ ] **Step 2: Fetch each website's company name and wire the switcher + copy**

```typescript
const companiesByWebsiteId = new Map(
  (await db.clientProfile.findMany({
    where: { id: { in: [...new Set(websites.map((w) => w.clientProfileId))] } },
    select: { id: true, name: true },
  })).map((p) => [p.id, p.name])
);
const pickable = selectableWebsites(websites).map((w) => ({ id: w.id, url: w.url, profileName: companiesByWebsiteId.get(w.clientProfileId) }));
```

```tsx
<SiteSwitcher
  websites={pickable}
  currentWebsiteId={selected.id}
  profileName={clientProfile?.name}
  hrefPattern="/settings?websiteId={id}"
/>
<span className="text-xs text-muted-foreground">
  Learning shows this site. Brand and Marketing Memory apply to every site of {clientProfile?.name ?? 'this company'}.
</span>
```

- [ ] **Step 3: Manual check** — Task 2/3's tests already cover the underlying resolution and per-item labels; this step is pure wiring with no new logic of its own.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(brand-voice-isolation): Settings switcher lists every company, copy names the company"
```

---

### Task 5: `POST /api/websites` — new-company vs. existing-company choice

**Files:**
- Modify: `src/app/api/websites/route.ts`
- Test: `src/app/api/websites/route.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `createClientProfileWithEntitlementCheck`, `createWebsiteWithEntitlementCheck` (`src/lib/entitlements.ts`, both already exist, unchanged), `resolveWebsiteForRequest` (Task 2).
- Produces: `POST /api/websites` body is now `{ url: string; mode?: 'new_company' | 'existing_company'; clientProfileId?: string }`. `mode` defaults to `'new_company'` when absent — preserves `WebsiteEntryPanel`'s existing quick-add contract (`src/components/dashboard/website-entry-panel.tsx`, unchanged, never sends `mode`) exactly as the human-approved design states ("New company (default)"). `existing_company` requires `clientProfileId` owned by this customer (tenant isolation) or 400s. Response gains `clientProfileId`.

- [ ] **Step 1: Write the failing tests** (extend the existing `describe('POST /api/websites')` block; extend its `vi.mock('@/lib/entitlements', ...)` to also export `createClientProfileWithEntitlementCheck: vi.fn()`, and add a `makeRequestWithBody(body)` helper alongside the existing `makeRequest`)

```typescript
import { createClientProfileWithEntitlementCheck } from '@/lib/entitlements';

it('creates a brand-new client profile for mode "new_company" (the default), named from the real host', async () => {
  (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
    customer: { id: 'cust_1' }, website: { clientProfileId: 'cp_default' }, websites: [],
  });
  (createClientProfileWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cp_new' });
  (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w_new', url: 'https://newco.test', clientProfileId: 'cp_new' });

  const res = await POST(makeRequest('https://newco.test'));

  expect(createClientProfileWithEntitlementCheck).toHaveBeenCalledWith({ customerId: 'cust_1', name: 'newco.test' });
  expect(createWebsiteWithEntitlementCheck).toHaveBeenCalledWith({ clientProfileId: 'cp_new', url: 'https://newco.test' });
  expect((await res.json()).clientProfileId).toBe('cp_new');
});

it('attaches to an existing client profile for mode "existing_company"', async () => {
  (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
    customer: { id: 'cust_1' }, website: { clientProfileId: 'cp_default' },
    websites: [{ id: 'w1', clientProfileId: 'cp_existing', normalizedHost: 'other.test' }],
  });
  (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w_new', url: 'https://b.test', clientProfileId: 'cp_existing' });

  const res = await POST(makeRequestWithBody({ url: 'https://b.test', mode: 'existing_company', clientProfileId: 'cp_existing' }));

  expect(createClientProfileWithEntitlementCheck).not.toHaveBeenCalled();
  expect(createWebsiteWithEntitlementCheck).toHaveBeenCalledWith({ clientProfileId: 'cp_existing', url: 'https://b.test' });
  expect(res.status).toBe(201);
});

it('rejects mode "existing_company" naming a client profile this customer does not own (tenant isolation)', async () => {
  (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
    customer: { id: 'cust_1' }, website: { clientProfileId: 'cp_default' },
    websites: [{ id: 'w1', clientProfileId: 'cp_mine', normalizedHost: 'a.test' }],
  });

  const res = await POST(makeRequestWithBody({ url: 'https://b.test', mode: 'existing_company', clientProfileId: 'cp_someone_elses' }));

  expect(res.status).toBe(400);
  expect(createWebsiteWithEntitlementCheck).not.toHaveBeenCalled();
});

it('scopes GSC-token inheritance to siblings of the TARGET company only, never across companies', async () => {
  (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
    customer: { id: 'cust_1' }, website: { clientProfileId: 'cp_default' },
    websites: [
      { id: 'w_a', clientProfileId: 'cp_a', normalizedHost: 'a.test', gscRefreshToken: 'tok_a', gscReconnectRequired: false },
      { id: 'w_b', clientProfileId: 'cp_b', normalizedHost: 'b.test', gscRefreshToken: null, gscReconnectRequired: false },
    ],
  });
  (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'w_new', url: 'https://c.test', clientProfileId: 'cp_b' });

  await POST(makeRequestWithBody({ url: 'https://c.test', mode: 'existing_company', clientProfileId: 'cp_b' }));

  expect(db.website.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/websites/route.test.ts`
Expected: FAIL — current route has no `mode` handling and never calls `createClientProfileWithEntitlementCheck`.

- [ ] **Step 3: Implement**

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest } from '@/lib/customer';
import {
  createWebsiteWithEntitlementCheck,
  createClientProfileWithEntitlementCheck,
  normalizeSiteUrl,
  EntitlementLimitError,
  DuplicateWebsiteError,
} from '@/lib/entitlements';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const { url, mode = 'new_company', clientProfileId } = body;
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'A URL is required.' }, { status: 400 });
  }
  if (mode !== 'new_company' && mode !== 'existing_company') {
    return NextResponse.json({ error: 'Invalid mode.' }, { status: 400 });
  }

  const { customer, websites } = await resolveWebsiteForRequest(userId);

  const normalizedHost = normalizeSiteUrl(url);
  const existing = websites.find((w) => w.normalizedHost === normalizedHost);
  if (existing) {
    return NextResponse.json({ id: existing.id, url: existing.url, clientProfileId: existing.clientProfileId, reused: true }, { status: 200 });
  }

  let targetClientProfileId: string;
  if (mode === 'existing_company') {
    if (typeof clientProfileId !== 'string' || !websites.some((w) => w.clientProfileId === clientProfileId)) {
      return NextResponse.json({ error: 'That company is not part of your workspace.' }, { status: 400 });
    }
    targetClientProfileId = clientProfileId;
  } else {
    try {
      const created = await createClientProfileWithEntitlementCheck({ customerId: customer.id, name: normalizedHost });
      targetClientProfileId = created.id;
    } catch (err) {
      if (err instanceof EntitlementLimitError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  }

  try {
    const created = await createWebsiteWithEntitlementCheck({ clientProfileId: targetClientProfileId, url });

    const companySiblings = websites.filter((w) => w.clientProfileId === targetClientProfileId);
    const siblingWithToken = companySiblings.find((w) => w.gscRefreshToken && !w.gscReconnectRequired);
    const gscInherited = Boolean(siblingWithToken);
    if (siblingWithToken) {
      await db.website.update({ where: { id: created.id }, data: { gscRefreshToken: siblingWithToken.gscRefreshToken } });
    }

    return NextResponse.json({ id: created.id, url: created.url, clientProfileId: created.clientProfileId, gscInherited, reused: false }, { status: 201 });
  } catch (err) {
    if (err instanceof EntitlementLimitError || err instanceof DuplicateWebsiteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/websites/route.test.ts`
Expected: PASS, including every pre-existing test (401/400/reuse cases unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/websites/route.ts src/app/api/websites/route.test.ts
git commit -m "feat(brand-voice-isolation): add-website chooses new company vs existing company"
```

---

### Task 6: Brand isolation proof — Studio never leaks company A's brand into company B

**Files:**
- Test: whichever function actually assembles the brand-voice grounding block fed to the content model (locate it first under `src/lib/content-studio/`), extending its existing test file.

- [ ] **Step 1: Investigate first** — confirm the grounding builder keys strictly off the resolved `website.clientProfileId` (already true per the dispatch's own note), then write ONE test instantiating two `ClientProfile`s with different `brandVoice`/`audience`/`approvedClaims`/`restrictedWording` and two `Website`s, one per profile, asserting a draft request for company B's website never contains any of company A's values anywhere in the prompt/grounding data.

- [ ] **Step 2: Run the test**

Run: `npx vitest run <the chosen test file>`
Expected: PASS immediately (confirms the existing boundary already generalizes, no production code change needed) — if it unexpectedly fails, that is a second, more serious bug to fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add <the chosen test file>
git commit -m "test(brand-voice-isolation): confirm Studio grounding never crosses company boundaries"
```

---

### Task 7: "Make this its own company" migration action

**Files:**
- Create: `src/app/api/websites/[id]/split-company/route.ts`
- Test: `src/app/api/websites/[id]/split-company/route.test.ts`

**Interfaces:**
- Produces: `POST /api/websites/:id/split-company` → `{ clientProfileId: string }` on success. Creates a new `ClientProfile` (name = the website's `normalizedHost`, brand fields copied verbatim from the website's current profile as a starting point, `isDefault: false`), then in the same transaction: updates `Website.clientProfileId` to the new profile first (composite-FK order matters — `ProfileSuggestion`'s FK is `(websiteId, clientProfileId) -> Website(id, clientProfileId)`, so the Website row must already carry the new value before any `ProfileSuggestion` row referencing it is updated to match), then updates every `ProfileSuggestion`/`ResearchJob`/`ContentRecommendation` row whose `websiteId` matches to the new `clientProfileId`. `CompetitorEntity` rows deliberately stay on the original profile (flagged gap above); `ContentPiece` rows are never touched.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest } from '@/lib/customer';
import { POST } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/customer', () => ({ resolveWebsiteForRequest: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: vi.fn() } }));

function makeRequest() { return {} as any; }

describe('POST /api/websites/:id/split-company', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    expect(res.status).toBe(401);
  });

  it('rejects a website this customer does not own via resolveWebsiteForRequest\'s own ownership check', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    expect(res.status).toBe(404);
  });

  it('creates the new profile, moves Website/ProfileSuggestion/ResearchJob/ContentRecommendation, never touches CompetitorEntity or ContentPiece', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    const oldProfile = { businessDescription: 'desc', audience: 'aud', brandVoice: 'voice', approvedClaims: ['x'], restrictedWording: ['y'], markets: ['DE'], languages: ['de'] };
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'cp_old', normalizedHost: 'b.test', clientProfile: oldProfile },
    });
    const tx = {
      clientProfile: { create: vi.fn().mockResolvedValue({ id: 'cp_new' }) },
      website: { update: vi.fn() },
      profileSuggestion: { updateMany: vi.fn() },
      researchJob: { updateMany: vi.fn() },
      contentRecommendation: { updateMany: vi.fn() },
    };
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: any) => fn(tx));

    const res = await POST(makeRequest(), { params: { id: 'w1' } });

    expect(tx.clientProfile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: 'cust_1', name: 'b.test', businessDescription: 'desc', brandVoice: 'voice', isDefault: false }),
    }));
    expect(tx.website.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect(tx.profileSuggestion.updateMany).toHaveBeenCalledWith({ where: { websiteId: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect(tx.researchJob.updateMany).toHaveBeenCalledWith({ where: { websiteId: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect(tx.contentRecommendation.updateMany).toHaveBeenCalledWith({ where: { websiteId: 'w1' }, data: { clientProfileId: 'cp_new' } });
    expect((tx as Record<string, unknown>).competitorEntity).toBeUndefined();
    expect((tx as Record<string, unknown>).contentPiece).toBeUndefined();
    expect((await res.json()).clientProfileId).toBe('cp_new');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/websites/[id]/split-company/route.test.ts`
Expected: FAIL — route file does not exist yet.

- [ ] **Step 3: Implement**

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest } from '@/lib/customer';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  let customer, website;
  try {
    ({ customer, website } = await resolveWebsiteForRequest(userId, params.id));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 404;
    return NextResponse.json({ error: 'Website not found.' }, { status });
  }

  const old = (website as typeof website & {
    clientProfile: { businessDescription: string | null; audience: string | null; brandVoice: string | null; approvedClaims: string[]; restrictedWording: string[]; markets: string[]; languages: string[] };
  }).clientProfile;

  const result = await db.$transaction(async (tx) => {
    const newProfile = await tx.clientProfile.create({
      data: {
        customerId: customer.id,
        name: website.normalizedHost,
        businessDescription: old.businessDescription,
        audience: old.audience,
        brandVoice: old.brandVoice,
        approvedClaims: old.approvedClaims,
        restrictedWording: old.restrictedWording,
        markets: old.markets,
        languages: old.languages,
        isDefault: false,
      },
    });

    // Composite-FK order matters: ProfileSuggestion's FK is (websiteId, clientProfileId)
    // -> Website(id, clientProfileId), so the Website row must already carry the new
    // clientProfileId before any ProfileSuggestion row pointing at it is updated to match.
    await tx.website.update({ where: { id: website.id }, data: { clientProfileId: newProfile.id } });
    await tx.profileSuggestion.updateMany({ where: { websiteId: website.id }, data: { clientProfileId: newProfile.id } });
    await tx.researchJob.updateMany({ where: { websiteId: website.id }, data: { clientProfileId: newProfile.id } });
    await tx.contentRecommendation.updateMany({ where: { websiteId: website.id }, data: { clientProfileId: newProfile.id } });
    // CompetitorEntity has no websiteId column -- there is no principled way to split
    // it by website, so it deliberately stays with the original profile.
    // ContentPiece.clientProfileId is never rewritten -- past content keeps its real
    // original attribution, per explicit instruction not to rewrite history.

    return newProfile;
  });

  return NextResponse.json({ clientProfileId: result.id }, { status: 200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/websites/[id]/split-company/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/websites/[id]/split-company/
git commit -m "feat(brand-voice-isolation): Make this its own company migration action"
```

---

### Task 8: UI — add-website choice control + "Make this its own company" button

**Files:**
- Modify: `src/components/settings/add-website-form.tsx`
- Modify: `src/app/settings/page.tsx` (pass the customer's company list; add the new action button per website row)
- Test: `src/components/settings/add-website-form.test.tsx` (new)

**Interfaces:**
- Consumes: `POST /api/websites` (Task 5), `POST /api/websites/:id/split-company` (Task 7).
- Produces: `AddWebsiteForm({ companies: { id: string; name: string }[] })`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/components/settings/add-website-form.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AddWebsiteForm } from './add-website-form';

afterEach(() => vi.restoreAllMocks());

describe('AddWebsiteForm — new vs existing company', () => {
  it('defaults to "New company" and posts no clientProfileId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AddWebsiteForm companies={[{ id: 'cp_1', name: 'acme.test' }]} />);
    fireEvent.change(screen.getByLabelText(/add a website/i), { target: { value: 'https://new.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await Promise.resolve();
    const b = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(b.mode).toBe('new_company');
    expect(b.clientProfileId).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('posts the chosen clientProfileId when "Another site of an existing company" is selected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AddWebsiteForm companies={[{ id: 'cp_1', name: 'acme.test' }]} />);
    fireEvent.click(screen.getByRole('radio', { name: /existing company/i }));
    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: 'cp_1' } });
    fireEvent.change(screen.getByLabelText(/add a website/i), { target: { value: 'https://b.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await Promise.resolve();
    const b = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(b).toMatchObject({ mode: 'existing_company', clientProfileId: 'cp_1' });
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/settings/add-website-form.test.tsx`
Expected: FAIL — component doesn't accept `companies` prop or emit `mode`/`clientProfileId` yet.

- [ ] **Step 3: Implement** — add a two-option radio group (`New company` default-checked, `Another site of an existing company` revealing a `<select>` of `companies` when checked) above the existing URL input; wire `mode`/`clientProfileId` into the existing `fetch` body. Tier 2 design pass: reuse existing `Button`/radio patterns already in the codebase, no new color tokens.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/settings/add-website-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `companies` from `settings/page.tsx`** (all of the customer's own `ClientProfile`s) and add a "Make this its own company" button next to each website row, posting to Task 7's route and calling `router.refresh()` on success (the website id is unchanged by the split, only its `clientProfileId` moves).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/add-website-form.tsx src/components/settings/add-website-form.test.tsx src/app/settings/page.tsx
git commit -m "feat(brand-voice-isolation): Settings UI for new/existing company and splitting a website off"
```

---

### Task 9: Exit gate

- [ ] **Step 1:** `npx tsc --noEmit` — clean.
- [ ] **Step 2:** `npx vitest run` — all green, including every new test above.
- [ ] **Step 3:** `npx next build` — expect the same pre-existing `/`, `/dashboard`, `/studio`, `/review`, `/settings` prerender failures confirmed unrelated to this work (`da115f9`'s exit-gate note), not a new one.
- [ ] **Step 4:** Six-skill design receipts for Task 8's UI in the done report. 320/768/1280px screenshots of Settings — blocked by the standing Clerk-sandbox gap, noted explicitly.
- [ ] **Step 5:** Reply to god with the final commit hash, exit-gate results, and the `CompetitorEntity` gap called out again for visibility.

---

## Self-Review Notes

- Spec coverage: all 5 numbered items in the dispatch map to a task above (1→5&8, 2→1, 3→2&3&4&6, 4→7, 5→ every task's own tests + Task 9).
- The `CompetitorEntity` gap is the one place this plan deviates from a literal reading of the dispatch — flagged twice (here and in Task 7) rather than silently guessing a partition rule for a column that doesn't exist.
