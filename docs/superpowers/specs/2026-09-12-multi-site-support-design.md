# Multi-Site Support — Design Spec

## Context

Triggered by a real support moment: a user typed a different site's URL into the
command bar and got "Dex currently audits your connected site
(`https://acme.com`) only — it doesn't scan arbitrary URLs yet." That message
is correct and intentional (Milestone C's command bar deliberately never
scans an arbitrary, unowned URL — that's an SSRF/abuse surface reserved for
brief-section-5's "real audit agents" work, which will do it with proper
hardening). The actual gap it exposed: **the backend has supported more than
one website per workspace since Milestone B — `ClientProfile.maxWebsites`
defaults to 3, and `createWebsiteWithEntitlementCheck` already enforces that
limit atomically — but nothing in the app ever calls it.** There is no way to
add a second website, and every route that touches "the" website
(`dashboard/page.tsx`, `command-bar/route.ts`, `scan/route.ts`,
`settings/page.tsx`, the GSC connect chain) hard-codes
`customer.clientProfiles[0].websites[0]`.

This spec closes that gap: let a workspace add and switch between multiple
websites under its existing default `ClientProfile`.

**Explicitly out of scope:** a `ClientProfile` switcher (agencies managing
multiple *clients*, not multiple *sites* for one client — `maxClientProfiles`
stays at 1, untouched). Scanning arbitrary/unowned URLs — that's brief-section-5,
not this. Any Prisma schema change — `Website` already has everything this
needs.

## Architecture

**Site identity lives in the URL.** `/dashboard` becomes
`/dashboard/[websiteId]`; bare `/dashboard` becomes a thin redirect to the
caller's default website's dashboard. This is bookmarkable and shareable and
needs no new persistence layer — the alternative (a remembered
cookie/session selection) was considered and rejected because it makes "the
dashboard for site X" unlinkable.

**One resolver, reused everywhere.** A single `resolveWebsiteForRequest`
function in `src/lib/customer.ts` replaces the
`customer.clientProfiles[0].websites[0]` idiom that's currently duplicated
across nine files. Given an optional `websiteId`, it ownership-checks and
returns that website (plus the full sibling list, for switcher UI); given
none, it returns the first website (today's implicit default), so the bare
`/dashboard` redirect and any route that doesn't yet need multi-site
awareness can still call it with zero arguments and get the old behavior
unchanged.

```ts
// src/lib/customer.ts
export class WebsiteNotFoundError extends Error {}

export async function resolveWebsiteForRequest(
  clerkUserId: string,
  websiteId?: string
): Promise<{ customer: Customer; website: Website; websites: Website[] }> {
  const { customer } = await ensureCustomer(clerkUserId, PENDING_WEBSITE_URL);
  const profile = await db.clientProfile.findFirst({
    where: { customerId: customer.id, isDefault: true },
    include: { websites: { orderBy: { createdAt: 'asc' } } },
  });
  const websites = profile?.websites ?? [];
  if (websites.length === 0) {
    // Shouldn't happen post-ensureCustomer, but don't leave the caller stuck.
    throw new Error(`Customer ${customer.id} has no default website`);
  }
  if (!websiteId) return { customer, website: websites[0], websites };
  const website = websites.find((w) => w.id === websiteId);
  if (!website) throw new WebsiteNotFoundError(`Website ${websiteId} not found on this workspace.`);
  return { customer, website, websites };
}
```

**Review queue stays global — no restructure.** `/review/page.tsx` already
queries `db.action.findMany({ where: { customerId: customer.id, ... } })` —
it's workspace-wide, not site-scoped, and already shows pending actions
across every website a customer has. This was a wrong assumption in the
verbal design (which proposed `/review/[websiteId]`) caught while writing
this spec by actually reading the file. Leaving it alone is both less work
and better UX — a reviewer shouldn't have to switch sites to see everything
waiting on them.

## Components

- **`src/lib/customer.ts`** — add `resolveWebsiteForRequest` +
  `WebsiteNotFoundError` (above). `ensureCustomer`/`PENDING_WEBSITE_URL`
  unchanged.
- **`src/app/dashboard/page.tsx`** (new, thin) — resolves the default
  website via `resolveWebsiteForRequest(userId)` and redirects to
  `/dashboard/${website.id}`.
- **`src/app/dashboard/[websiteId]/page.tsx`** (moved from
  `src/app/dashboard/page.tsx`) — reads `params.websiteId`, calls
  `resolveWebsiteForRequest(userId, params.websiteId)`; a
  `WebsiteNotFoundError` renders Next's `notFound()`. Everything else in the
  file is unchanged except: `UtilityBar` gets two new props (`websites`,
  `currentWebsiteId`); `CommandBar` gets a new `websiteId` prop; the
  "Scan now" form gets a hidden `websiteId` input; every internal
  `/dashboard?tab=...` href becomes `/dashboard/${website.id}?tab=...`.
  `src/app/dashboard/layout.tsx` needs no change — Next.js nests it over
  both the new redirect page and the `[websiteId]` page automatically.
- **`src/components/app-shell/utility-bar.tsx`** — add `websites:
  { id: string; url: string }[]` and `currentWebsiteId: string` props;
  render `<SiteSwitcher>` (new) instead of the bare `<span>{websiteUrl}</span>`
  when `websites.length > 1`, otherwise keep today's plain text (no
  switcher clutter for the common single-site case).
- **`src/components/app-shell/site-switcher.tsx`** (new, client) — a
  `<select>` (matches the existing GSC-property picker's own plain-`<select>`
  pattern on the dashboard) listing `websites` by `url`, `onChange` calling
  `router.push('/dashboard/' + selectedId)`.
- **`src/app/api/command-bar/route.ts`** — `POST` body gains an optional
  `websiteId`; resolves via `resolveWebsiteForRequest(userId, websiteId)`
  instead of the hard-coded lookup. The two hrefs that currently read
  `/dashboard?tab=overview` / `/dashboard?tab=review` / `/dashboard?tab=outcomes`
  become `/dashboard/${website.id}?tab=...`.
- **`src/components/dashboard/command-bar.tsx`** — new required prop
  `websiteId: string`, included in the POST body.
- **`src/app/api/scan/route.ts`** — reads `websiteId` from the posted form
  data (falls back to `resolveWebsiteForRequest(userId)`'s default if
  absent, so nothing breaks if some caller doesn't send it yet), redirects
  to `/dashboard/${website.id}` instead of the bare `/dashboard`.
- **`src/app/api/settings/auto-execute/route.ts`** — body gains
  `websiteId`; resolves via `resolveWebsiteForRequest`.
- **`src/components/auto-execute-toggle.tsx`** — new required prop
  `websiteId: string`, included in its POST body.
- **`src/app/api/websites/route.ts`** (new) — `POST { url: string }`.
  Resolves the caller's default `ClientProfile` (via the customer lookup
  already used everywhere else — `maxClientProfiles` is 1, so this is
  always `clientProfiles[0]`), calls
  `createWebsiteWithEntitlementCheck({ clientProfileId, url })`. On success,
  checks sibling websites on that profile for one with a non-null
  `gscRefreshToken`; if found, copies it onto the new website immediately
  (`db.website.update`) — same Google account already granted access, no
  reason to make the user OAuth twice. Returns the created website as JSON
  (id, url, whether it inherited a GSC token) for the settings page to act
  on. Surfaces `EntitlementLimitError`/`DuplicateWebsiteError` as 400s with
  their own `.message`.
- **`src/app/settings/page.tsx`** (restructured) — lists every website on
  the default client profile (not just `websites[0]`): url, normalized
  host, a GSC-connected badge, and — inline, no route change to
  `/settings` itself — an "Add website" form posting to
  `POST /api/websites`. Each row's auto-execute toggle now passes that
  row's own `websiteId`. A row without a GSC token shows "Connect Search
  Console" linking to `/api/gsc/connect?websiteId=${id}`. A row whose GSC
  token was just inherited (still on the old `PENDING_WEBSITE_URL`-shaped
  URL until a real property is picked) shows the same verified-property
  `<select>` UI the dashboard already has for the very first site, posting
  to `/api/gsc/select-site` with a `websiteId` hidden field.
- **`src/app/api/gsc/connect/route.ts`** — reads a required `?websiteId=`
  query param, ownership-checks it via `resolveWebsiteForRequest`, stores
  it in a second cookie, `gsc_oauth_website_id` (same options as the
  existing `gsc_oauth_state` cookie: httpOnly, sameSite lax, 600s maxAge).
  Missing/invalid `websiteId` → 400 before ever redirecting to Google.
- **`src/app/api/gsc/callback/route.ts`** — reads the new
  `gsc_oauth_website_id` cookie (400 if missing — the connect step always
  sets it), resolves that specific website via `resolveWebsiteForRequest`
  instead of `websites[0]`, deletes both cookies on success.
- **`src/app/api/gsc/select-site/route.ts`** — reads a `websiteId` field
  from the posted form data (falls back to `resolveWebsiteForRequest`'s
  default for backward compatibility with the existing first-site flow),
  resolves and updates that specific website instead of `websites[0]`.

## Data Flow — adding a second website

1. User opens `/settings`, fills in a URL, submits the "Add website" form.
2. `POST /api/websites` → `createWebsiteWithEntitlementCheck` (existing,
   untouched) → on success, check siblings for a `gscRefreshToken` to
   inherit.
3. **Inherited a token:** the new website already has Search Console
   access; the settings page immediately shows its verified-property
   picker (same UI pattern as the dashboard's first-run flow), posting to
   `/api/gsc/select-site` with that website's id.
4. **No sibling token (first-ever GSC connection on this profile):** the
   row shows "Connect Search Console" → `/api/gsc/connect?websiteId=${id}`
   → Google OAuth → `/api/gsc/callback` (reads the id from its cookie,
   stores the token on that exact website) → back to `/settings` →
   verified-property picker as in step 3.
5. Either way, once a real property is selected, that website appears in
   the dashboard's `SiteSwitcher` and is fully usable — scans, command bar,
   auto-execute, all scoped correctly through `resolveWebsiteForRequest`.

## Error Handling

- Any `websiteId`-scoped route/page given an id that doesn't belong to the
  caller: `WebsiteNotFoundError` → 404 (pages) / 404 JSON (routes). Same
  posture as every other ownership check in this codebase — no
  distinguishing "doesn't exist" from "not yours."
- `createWebsiteWithEntitlementCheck`'s existing `EntitlementLimitError`
  and `DuplicateWebsiteError` surface verbatim as the "Add website" form's
  error message — no new error types needed.
- `/api/gsc/connect` with a missing/foreign `websiteId`: 400 before
  touching Google, same as today's missing-customer case.
- `/api/gsc/callback` with a missing `gsc_oauth_website_id` cookie
  (expired, or a connect request that predates this change mid-flight):
  400, same shape as the existing missing-state-cookie check.

## Testing

- `resolveWebsiteForRequest` unit tests: no-`websiteId` returns the first
  website (unchanged default behavior); a valid owned `websiteId` returns
  that website; a foreign/unknown `websiteId` throws
  `WebsiteNotFoundError`; returns the full `websites` array in site-created
  order.
- `POST /api/websites` route tests: success creates and returns a website;
  entitlement-limit and duplicate-host cases surface as 400 with the
  underlying error message; GSC-token inheritance actually copies the
  token onto the new row when a sibling has one, and leaves it `null` when
  no sibling does.
- `/api/gsc/connect` route test: missing `websiteId` → 400; a foreign
  `websiteId` → 400; a valid one sets both cookies and redirects to
  Google.
- `/api/gsc/callback` route test: missing `gsc_oauth_website_id` cookie →
  400; a valid cookie updates the specific website named, not
  `websites[0]`.
- `/api/gsc/select-site` route test: extended for an explicit `websiteId`
  form field targeting a non-default website.
- `/api/command-bar` route test: extended so a `websiteId` in the POST
  body resolves and scopes to that website (not always the first); an href
  in a response now contains the resolved website's id.
- `dashboard/[websiteId]/page` and the bare `dashboard/page` redirect
  aren't unit-tested today (no existing page-test convention in this
  codebase — the App Router pages are exercised via `next build` + manual
  smoke check, matching every prior milestone's UI-page precedent).

Gate before commit, same as every milestone: `npx tsc --noEmit`,
`npx vitest run`, `npx next build`.
