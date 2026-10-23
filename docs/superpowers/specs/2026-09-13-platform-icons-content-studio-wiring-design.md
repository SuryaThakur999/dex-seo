# Platform Icons + Content Studio Wiring — Design

> Scope: Sub-slice A of Slice 2 of the DEX MASTER DIRECTIVE (Website-First
> Audits + Signal Room Workspace). Slices B (dashboard layout redesign) and
> C (charts/metrics honesty audit) are separate specs, not part of this one.

**Goal:** Give Content Studio recognizable platform icons instead of text
labels, make its status model honestly reflect that no real publish
integration exists yet, and make "open Studio from a finding" actually work
with the correct client/website/finding context — it doesn't today.

**Architecture:** One new `PlatformIcon` component backed by the
already-installed `react-icons/si` (Simple Icons) package for official brand
marks, plus a neutral icon for the non-platform `ugc_brief` case. Fix
`studio/page.tsx` to resolve its website via the shared multi-site resolver
instead of always defaulting to the customer's first site. Add one small
static mapping from action type to suggested platforms, and wire the
dashboard's findings list to link into Studio with real context.

## Current state (why this is needed)

- `content-studio-shell.tsx`'s `PLATFORM_LABELS` map is text-only — no
  icons anywhere in the app for LinkedIn, X, Facebook, Instagram, Reddit,
  TikTok, or YouTube.
- `react-icons` (`^5.7.0`) is already a project dependency. Its `si` export
  re-exports the Simple Icons set — official, single-color brand marks,
  each with an official `.color` hex — so no new package is needed.
- `studio/page.tsx` calls `ensureCustomer(userId, PENDING_WEBSITE_URL)`
  directly, bypassing `resolveWebsiteForRequest` entirely. It always opens
  the customer's default website and accepts no `websiteId` — a customer
  with multiple sites can never open Studio scoped to a specific one, and a
  finding from site B always opens Studio against site A's default.
- `ContentStudioShell` already has a `sourceActionId` text-input field the
  user must manually fill in — there is no link anywhere in the app that
  pre-fills it. Findings shown on the dashboard (`AttentionList`) have no
  path into Studio at all today.
- `ContentStatus` (Prisma enum: `draft, needs_assets, needs_review,
  approved, ready_to_publish, published, failed, archived`) already covers
  most of the directive's required distinctions (draft available/ready,
  needs-assets, approved-for-export, ready-to-publish/published). It does
  not, and cannot yet, represent "account connected" — no platform has a
  real OAuth/publish integration in this codebase.

## Component: `PlatformIcon`

`src/components/content-studio/platform-icon.tsx`:

```typescript
export function PlatformIcon({
  platform,
  size = 20,
  labeled = false,
}: {
  platform: ContentPlatform;
  size?: number;
  labeled?: boolean;
}): JSX.Element
```

- For the 7 real platforms: renders the matching `react-icons/si` component
  (`SiLinkedin`, `SiX`, `SiFacebook`, `SiInstagram`, `SiReddit`, `SiTiktok`,
  `SiYoutube`), colored with that icon's own `.color` (each `react-icons/si`
  export carries its official hex as a static property) — "use brand colors
  locally," per the directive.
- For `ugc_brief`: renders a neutral Phosphor icon (`UsersThree`, already a
  project dependency) in the app's muted-foreground color, since there is
  no real brand to represent.
- `labeled: true` renders icon + `PLATFORM_LABELS[platform]` text side by
  side (used in the platform picker, where clarity matters more than
  density). `labeled: false` (default) renders icon-only with
  `aria-label={PLATFORM_LABELS[platform]}` and `role="img"` (used in
  compact per-piece rows and findings-list suggestions, where space is
  tight).
- One component, one place platform-icon logic lives — `content-studio-shell.tsx`'s
  platform `<select>` and per-piece rows both import it instead of duplicating
  icon-or-label branching.

## Status model: honest "not connected," not a fake toggle

No new schema field. The existing `ContentStatus` enum stays exactly as-is
and continues to drive the `draft → needs_review → approved →
ready_to_publish → published` flow already implemented in
`NEXT_STATUS`.

Two additions, both purely presentational, both hard-coded to their honest
current value since no real integration exists to make them dynamic:

- A static "Not connected" badge (neutral color, not an error state) shown
  next to each platform's section in Content Studio — this is what "a logo
  does not establish account connection" becomes concretely: the logo and
  the connection-status badge are visually separate, so no one can look at
  a LinkedIn icon and think the account is linked.
- The `ready_to_publish → published` transition button in
  `content-studio-shell.tsx`'s `handleStatusChange` flow gets `disabled`
  with a tooltip ("Publishing isn't connected for this platform yet")
  instead of being clickable — clicking it today would flip a database
  status with no actual publish ever happening, which is exactly the "fake
  activity" the master directive prohibits. The `approved` state (an
  exportable draft) stays fully available — that's the real, working
  boundary of what this product currently does.

## Studio context wiring

**`studio/page.tsx`** changes: accept `websiteId` and `actionId` as
`searchParams`, resolve via `resolveWebsiteForRequest(userId, websiteId)`
(matching every other page in the app post multi-site work) instead of
`ensureCustomer(userId, PENDING_WEBSITE_URL)`. `clientProfile` is derived
from the resolved website exactly as today. `pendingActions` query stays
scoped to the resolved website's id (already correct once `website` comes
from the resolver instead of always being the default). An `actionId`
param, if present and found among `pendingActions`, pre-fills
`ContentStudioShell`'s `sourceActionId` state (new prop, `initialSourceActionId?: string`) instead
of requiring the user to type it.

**Suggested channels**: `src/lib/content-studio/suggest-channels.ts`, one
small static function:

```typescript
export function suggestChannelsForAction(actionType: string): { platform: ContentPlatform; rationale: string }[]
```

A static lookup table keyed on `actionType` (today only `meta_description`
exists as a real value produced by `run-scan.ts`) returning 1-2 platforms
with a short, generic, evidence-free-of-fabricated-metrics rationale (e.g.
`meta_description → [{ platform: 'linkedin', rationale: 'Good fit for
announcing an on-page content update to a professional audience.' },
{ platform: 'x', rationale: 'Short-form, works well for a quick update
post.' }]`). An unrecognized `actionType` returns `[]` — "not every SEO
issue requires a social post" becomes the empty-array case, not a forced
suggestion. A static table, not a scoring model, because there is exactly
one real `actionType` to map today — a general system would be solving a
problem this codebase doesn't have yet.

**Dashboard wiring**: `AttentionList` (the pending-findings list on the
dashboard overview) gains, per row, the suggested platform icons (from
`suggestChannelsForAction`) each linking to
`/studio?websiteId=<id>&actionId=<id>&platform=<platform>`. Clicking a
suggested platform's icon opens Studio pre-scoped to that exact site,
action, and platform — the concrete fix for "platform actions open the
existing Studio with correct client, website, audit and finding context."

## Testing

- `PlatformIcon`: renders the correct `react-icons/si` component per
  platform, correct `aria-label` in both `labeled` states, `ugc_brief`
  renders the neutral fallback.
- `suggestChannelsForAction`: known `actionType` returns its mapped
  platforms with non-empty rationale strings; unknown `actionType` returns
  `[]`.
- `studio/page.tsx`: cannot unit-test directly (no page-render harness in
  this codebase, established convention) — instead add a unit test for the
  underlying resolution logic if any is extracted, or accept this as a
  logic-only page verified by its route-level dependencies
  (`resolveWebsiteForRequest`) already being tested elsewhere. No new test
  harness introduced for this.
- `content-studio-shell.tsx`: this file has no existing test file (a
  client component); no new test harness introduced here either — its
  behavior is exercised through the existing `/api/content-studio/drafts`
  route tests, which are untouched by this change.
- `AttentionList` wiring: check whether this component already has a test
  file; if so, add cases for the new per-row suggested-platform links.

## Out of scope

Real OAuth/publish integrations for any platform (explicitly deferred —
"account connected" stays a static "not connected" until a real
integration exists). Dashboard layout redesign (Slice 2B). Chart/metrics
work (Slice 2C).
