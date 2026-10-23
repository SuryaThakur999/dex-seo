# Platform Icons + Content Studio Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-09-13-platform-icons-content-studio-wiring-design.md` (Slice 2A of the DEX MASTER DIRECTIVE): give Content Studio real platform icons, an honest "not connected" status model, and working client/website/finding-scoped links from the dashboard's findings list into Studio.

**Architecture:** One `PlatformIcon` component (`src/components/content-studio/platform-icon.tsx`) is the single source of truth for platform icon + label rendering, imported by `content-studio-shell.tsx` and `attention-list.tsx`. `studio/page.tsx` moves from `ensureCustomer` to `resolveWebsiteForRequest` and accepts `websiteId`/`actionId` query params. A new `suggestChannelsForAction` static lookup drives per-finding platform suggestions on the dashboard.

**Tech Stack:** Next.js 14 App Router, React 18 (automatic JSX runtime), `react-icons/si` (already a dependency), `@phosphor-icons/react` (already a dependency), Vitest (`environment: node`).

## Corrections to the spec (found during implementation research)

The spec's design section makes two claims about `react-icons/si` that do not hold for the installed version (`react-icons@5.7.0`) — both verified directly against the installed package, not assumed:

1. **No `SiLinkedin` export exists.** Simple Icons (the icon set `react-icons/si` re-exports) has dropped LinkedIn's mark. Fallback: Phosphor's `LinkedinLogo` (`@phosphor-icons/react`, already a dependency), `weight="fill"`, colored with LinkedIn's own published brand hex (`#0A66C2`) since Phosphor icons carry no brand-color metadata either.
2. **No `Si*` icon exposes a `.color` static property at runtime.** Inspected the generated icon source directly (`node_modules/react-icons/si/index.mjs`) — each icon function only carries an SVG `role`/`viewBox`/path `d`, nothing else. `PlatformIcon` therefore ships its own `PLATFORM_COLORS` map of each brand's published mark color instead of reading `.color` off the icon component.

One additional scope call, not a spec error: the spec says the platform `<select>` in `content-studio-shell.tsx` should "import" `PlatformIcon`, but a native `<select>`/`<option>` cannot host arbitrary React elements in any browser. Task 2 keeps the native select (unchanged interaction, no redesign — that's Slice 2B's job) and instead renders a `labeled` `PlatformIcon` preview of the current selection next to it, which is where the spec's `labeled: true` mode actually gets used.

## Global Constraints

- No new dependencies — `react-icons` and `@phosphor-icons/react` are both already in `package.json`.
- `PlatformIcon` has no `'use client'` directive and no hooks — it must render correctly from both server components (`attention-list.tsx`, dashboard page) and the client component (`content-studio-shell.tsx`), so import Phosphor icons from `@phosphor-icons/react/dist/ssr` (matches the existing server-icon convention in `src/app/dashboard/[websiteId]/page.tsx`), not the client-interactive `@phosphor-icons/react` entry point (that one's reserved for files that are already `'use client'`, per `src/components/ui/extended-toolbar.tsx`'s existing convention).
- No new schema field for "connected" — `ContentStatus` is unchanged (spec: "No new schema field").
- Real OAuth/publish integrations stay explicitly out of scope.
- Gate before every commit that touches app code: `npx tsc --noEmit`; run `npx vitest run <changed test file>` for tasks that add tests; run `npx next build` for tasks that touch a page or a component rendered from one (Tasks 4-6).
- Per this project's CLAUDE.md: before marking the feature done, start the dev server and manually exercise the change in a browser (Task 6) — type-checking and unit tests verify correctness, not that the feature actually works end-to-end.

---

## Task 1: `PlatformIcon` component

**Files:**
- Create: `src/components/content-studio/platform-icon.tsx`
- Test: `src/components/content-studio/platform-icon.test.tsx`

**Interfaces:**
- Produces: `PLATFORM_LABELS: Record<ContentPlatform, string>`, `PlatformIcon({ platform, size, labeled }): JSX.Element`. Consumed by Task 2 (`content-studio-shell.tsx`) and Task 5 (`attention-list.tsx`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/content-studio/platform-icon.test.tsx
import { describe, it, expect } from 'vitest';
import { SiFacebook, SiInstagram, SiReddit, SiTiktok, SiX, SiYoutube } from 'react-icons/si';
import { LinkedinLogo, UsersThree } from '@phosphor-icons/react/dist/ssr';
import { PlatformIcon, PLATFORM_LABELS } from './platform-icon';
import type { ContentPlatform } from '@prisma/client';

const REAL_PLATFORM_COMPONENTS: Record<Exclude<ContentPlatform, 'ugc_brief'>, unknown> = {
  linkedin: LinkedinLogo,
  x: SiX,
  facebook: SiFacebook,
  instagram: SiInstagram,
  reddit: SiReddit,
  tiktok: SiTiktok,
  youtube: SiYoutube,
};

describe('PlatformIcon', () => {
  it('renders the matching brand icon component for each of the 7 real platforms', () => {
    for (const platform of Object.keys(REAL_PLATFORM_COMPONENTS) as (keyof typeof REAL_PLATFORM_COMPONENTS)[]) {
      const el = PlatformIcon({ platform: platform as ContentPlatform });
      expect(el.type).toBe(REAL_PLATFORM_COMPONENTS[platform]);
    }
  });

  it('renders the neutral UsersThree glyph for ugc_brief', () => {
    const el = PlatformIcon({ platform: 'ugc_brief' });
    expect(el.type).toBe(UsersThree);
    expect(el.props.className).toBe('text-muted-foreground');
  });

  it('icon-only mode (default) sets role=img and aria-label to the platform label', () => {
    const el = PlatformIcon({ platform: 'x' });
    expect(el.props.role).toBe('img');
    expect(el.props['aria-label']).toBe('X');
  });

  it('icon-only mode does not mark the glyph aria-hidden', () => {
    const el = PlatformIcon({ platform: 'youtube' });
    expect(el.props['aria-hidden']).toBeUndefined();
  });

  it('labeled mode wraps a decorative (aria-hidden) icon and the visible label text', () => {
    const el = PlatformIcon({ platform: 'reddit', labeled: true });
    expect(el.type).toBe('span');
    const children = el.props.children as [
      { type: unknown; props: Record<string, unknown> },
      { props: { children: string } }
    ];
    const [glyph, label] = children;
    expect(glyph.type).toBe(SiReddit);
    expect(glyph.props['aria-hidden']).toBe(true);
    expect(glyph.props.role).toBeUndefined();
    expect(label.props.children).toBe('Reddit');
  });

  it('passes the requested size through to the glyph', () => {
    const el = PlatformIcon({ platform: 'tiktok', size: 32 });
    expect(el.props.size).toBe(32);
  });

  it('exposes PLATFORM_LABELS for all 8 platforms', () => {
    expect(PLATFORM_LABELS).toEqual({
      linkedin: 'LinkedIn',
      instagram: 'Instagram',
      facebook: 'Facebook',
      x: 'X',
      reddit: 'Reddit',
      tiktok: 'TikTok',
      youtube: 'YouTube',
      ugc_brief: 'UGC Brief',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/content-studio/platform-icon.test.tsx`
Expected: FAIL with "Cannot find module './platform-icon'"

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/content-studio/platform-icon.tsx
import { SiFacebook, SiInstagram, SiReddit, SiTiktok, SiX, SiYoutube } from 'react-icons/si';
import { LinkedinLogo, UsersThree } from '@phosphor-icons/react/dist/ssr';
import type { ContentPlatform } from '@prisma/client';

export const PLATFORM_LABELS: Record<ContentPlatform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  reddit: 'Reddit',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  ugc_brief: 'UGC Brief',
};

// react-icons/si ships Simple Icons' SVG paths only — no brand hex is exposed
// at runtime on any Si* export (checked directly: react-icons 5.7.0's
// generated icon files carry `role`/`viewBox`/path `d` and nothing else).
// Simple Icons has also dropped LinkedIn's mark from its set entirely (no
// SiLinkedin export in this package version), so linkedin falls back to
// Phosphor's LinkedinLogo below. Hex values are each brand's own published
// mark color, not read off any icon library.
const PLATFORM_COLORS: Record<Exclude<ContentPlatform, 'ugc_brief'>, string> = {
  linkedin: '#0A66C2',
  x: '#000000',
  facebook: '#1877F2',
  instagram: '#E4405F',
  reddit: '#FF4500',
  tiktok: '#000000',
  youtube: '#FF0000',
};

function renderGlyph(platform: ContentPlatform, size: number, decorative: boolean) {
  // Icon-only usage carries its own aria-label/role; alongside visible text
  // (labeled mode) the glyph is decorative so screen readers don't announce
  // the platform name twice.
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': PLATFORM_LABELS[platform] };

  switch (platform) {
    case 'linkedin':
      return <LinkedinLogo size={size} color={PLATFORM_COLORS.linkedin} weight="fill" {...a11yProps} />;
    case 'x':
      return <SiX size={size} color={PLATFORM_COLORS.x} {...a11yProps} />;
    case 'facebook':
      return <SiFacebook size={size} color={PLATFORM_COLORS.facebook} {...a11yProps} />;
    case 'instagram':
      return <SiInstagram size={size} color={PLATFORM_COLORS.instagram} {...a11yProps} />;
    case 'reddit':
      return <SiReddit size={size} color={PLATFORM_COLORS.reddit} {...a11yProps} />;
    case 'tiktok':
      return <SiTiktok size={size} color={PLATFORM_COLORS.tiktok} {...a11yProps} />;
    case 'youtube':
      return <SiYoutube size={size} color={PLATFORM_COLORS.youtube} {...a11yProps} />;
    case 'ugc_brief':
      return <UsersThree size={size} className="text-muted-foreground" {...a11yProps} />;
  }
}

export function PlatformIcon({
  platform,
  size = 20,
  labeled = false,
}: {
  platform: ContentPlatform;
  size?: number;
  labeled?: boolean;
}) {
  if (!labeled) return renderGlyph(platform, size, false);
  return (
    <span className="inline-flex items-center gap-1.5">
      {renderGlyph(platform, size, true)}
      <span>{PLATFORM_LABELS[platform]}</span>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/content-studio/platform-icon.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/content-studio/platform-icon.tsx src/components/content-studio/platform-icon.test.tsx
git commit -m "$(cat <<'EOF'
feat: add PlatformIcon component with brand marks for Content Studio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 2: Wire `content-studio-shell.tsx` to `PlatformIcon` + honest "not connected" status

**Files:**
- Modify: `src/components/content-studio/content-studio-shell.tsx`

**Interfaces:**
- Consumes: `PlatformIcon`, `PLATFORM_LABELS` from `./platform-icon` (Task 1).
- No new exports — `ContentPieceView` and `ContentStudioShell`'s prop shape (aside from Task 4's addition) are unchanged.

This file has no existing test file (a client component, no test harness for this file per the spec — see Testing section of the spec) — verified by `tsc` + `next build` (Task 6) + manual smoke check (Task 6), matching this repo's established convention for client-component UI.

- [ ] **Step 1: Remove the duplicate `PLATFORM_LABELS` and import the shared one**

In `src/components/content-studio/content-studio-shell.tsx`, replace:

```typescript
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
// Type-only: erased at build time, so the client bundle stays Node-free while
// the label maps below are still checked against the schema enums.
import type { ContentPlatform, ContentStatus } from '@prisma/client';

export interface ContentPieceView {
  id: string;
  platform: ContentPlatform;
  topic: string;
  status: ContentStatus;
  failureReason: string | null;
}

const PLATFORM_LABELS: Record<ContentPlatform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  reddit: 'Reddit',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  ugc_brief: 'UGC Brief',
};
```

with:

```typescript
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PlatformIcon, PLATFORM_LABELS } from './platform-icon';
// Type-only: erased at build time, so the client bundle stays Node-free while
// the label maps below are still checked against the schema enums.
import type { ContentPlatform, ContentStatus } from '@prisma/client';

export interface ContentPieceView {
  id: string;
  platform: ContentPlatform;
  topic: string;
  status: ContentStatus;
  failureReason: string | null;
}
```

- [ ] **Step 2: Add a labeled `PlatformIcon` preview next to the platform picker**

The native `<select>` can't host icons inside its `<option>` elements in any browser, so it stays as-is; a `labeled` `PlatformIcon` preview of the current selection sits next to it instead — this is the spec's `labeled: true` use case ("used in the platform picker, where clarity matters more than density").

Replace:

```tsx
            <div className="flex flex-wrap gap-3">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as ContentPlatform)}
                className="h-9 rounded-md border border-border bg-transparent px-3 text-sm"
                aria-label="Platform"
              >
                {(Object.keys(PLATFORM_LABELS) as ContentPlatform[]).map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
              <select
```

with:

```tsx
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as ContentPlatform)}
                className="h-9 rounded-md border border-border bg-transparent px-3 text-sm"
                aria-label="Platform"
              >
                {(Object.keys(PLATFORM_LABELS) as ContentPlatform[]).map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
              <PlatformIcon platform={platform} labeled size={16} />
              <select
```

- [ ] **Step 3: Replace the text platform label with icon + "not connected" badge, and disable the unconnected publish transition**

Replace the entire `ContentPieceCard` function with:

```tsx
function ContentPieceCard({
  piece,
  onStatusChange,
}: {
  piece: ContentPieceView;
  onStatusChange: (id: string, status: ContentStatus) => void;
}) {
  const nextOptions = NEXT_STATUS[piece.status] ?? [];
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <PlatformIcon platform={piece.platform} size={18} />
            <span className="truncate text-sm font-medium text-foreground">{piece.topic}</span>
            <Badge variant="outline">Not connected</Badge>
          </div>
          <div className="flex shrink-0 gap-2">
            {nextOptions.map((status) => {
              const isUnconnectedPublish = piece.status === 'ready_to_publish' && status === 'published';
              if (isUnconnectedPublish) {
                return (
                  <Tooltip key={status}>
                    <TooltipTrigger asChild>
                      {/* Button's own `disabled:pointer-events-none` class
                          blocks hover on the button itself, so the tooltip
                          trigger sits on this wrapping span instead. */}
                      <span tabIndex={0} className="inline-block">
                        <Button size="sm" variant="outline" disabled>
                          {STATUS_LABELS[status]}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Publishing isn&apos;t connected for this platform yet.</TooltipContent>
                  </Tooltip>
                );
              }
              return (
                <Button key={status} size="sm" variant="outline" onClick={() => onStatusChange(piece.id, status)}>
                  {STATUS_LABELS[status]}
                </Button>
              );
            })}
            {piece.status !== 'archived' && (
              <Button size="sm" variant="ghost" onClick={() => onStatusChange(piece.id, 'archived')}>
                Archive
              </Button>
            )}
          </div>
        </div>
        {piece.status === 'failed' && piece.failureReason && (
          <p className="text-xs text-destructive">{piece.failureReason}</p>
        )}
        {piece.status !== 'failed' && (
          <a
            href={`/api/content-studio/drafts/${piece.id}/export`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-accent underline-offset-4 hover:underline"
          >
            View / copy export
          </a>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/content-studio/content-studio-shell.tsx
git commit -m "$(cat <<'EOF'
feat: wire Content Studio to PlatformIcon, add honest not-connected status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 3: `suggestChannelsForAction`

**Files:**
- Create: `src/lib/content-studio/suggest-channels.ts`
- Test: `src/lib/content-studio/suggest-channels.test.ts`

**Interfaces:**
- Produces: `ChannelSuggestion` (`{ platform: ContentPlatform; rationale: string }`), `suggestChannelsForAction(actionType: string): ChannelSuggestion[]`. Consumed by Task 5 (`attention-list.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/suggest-channels.test.ts
import { describe, it, expect } from 'vitest';
import { suggestChannelsForAction } from './suggest-channels';

describe('suggestChannelsForAction', () => {
  it('returns linkedin and x suggestions for meta_description, each with a non-empty rationale', () => {
    const result = suggestChannelsForAction('meta_description');
    expect(result.map((r) => r.platform)).toEqual(['linkedin', 'x']);
    for (const r of result) {
      expect(r.rationale.length).toBeGreaterThan(0);
    }
  });

  it('returns an empty array for an unrecognized actionType', () => {
    expect(suggestChannelsForAction('not_a_real_action_type')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/suggest-channels.test.ts`
Expected: FAIL with "Cannot find module './suggest-channels'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/suggest-channels.ts
import type { ContentPlatform } from '@prisma/client';

export interface ChannelSuggestion {
  platform: ContentPlatform;
  rationale: string;
}

// A static lookup, not a scoring model — `run-scan.ts` produces exactly one
// real actionType today (meta_description), so a general system would be
// solving a problem this codebase doesn't have yet. An unrecognized
// actionType returns [] deliberately: not every SEO issue needs a social
// post.
const SUGGESTIONS: Record<string, ChannelSuggestion[]> = {
  meta_description: [
    {
      platform: 'linkedin',
      rationale: 'Good fit for announcing an on-page content update to a professional audience.',
    },
    { platform: 'x', rationale: 'Short-form, works well for a quick update post.' },
  ],
};

export function suggestChannelsForAction(actionType: string): ChannelSuggestion[] {
  return SUGGESTIONS[actionType] ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/suggest-channels.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/content-studio/suggest-channels.ts src/lib/content-studio/suggest-channels.test.ts
git commit -m "$(cat <<'EOF'
feat: add suggestChannelsForAction static platform-suggestion lookup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 4: `studio/page.tsx` multi-site resolution + finding prefill

**Files:**
- Modify: `src/app/studio/page.tsx`
- Modify: `src/components/content-studio/content-studio-shell.tsx`

**Interfaces:**
- Consumes: `resolveWebsiteForRequest`, `WebsiteNotFoundError` from `@/lib/customer` (existing).
- Produces: `ContentStudioShell` gains `initialSourceActionId?: string` prop, used to seed the `sourceActionId` state instead of always starting at `''`.

No test step: this page has no page-render harness in this codebase (established convention — see the spec's Testing section), and `content-studio-shell.tsx` has no test file. Verified by `tsc` + `next build` + manual smoke check (Task 6).

- [ ] **Step 1: Add `initialSourceActionId` to `ContentStudioShell`**

In `src/components/content-studio/content-studio-shell.tsx`, change the function signature from:

```typescript
export function ContentStudioShell({
  clientProfileId,
  initialPieces,
  pendingActions,
  initialPlatform,
  initialTopic,
}: {
  clientProfileId: string;
  initialPieces: ContentPieceView[];
  pendingActions: { id: string; pageUrl: string; actionType: string }[];
  initialPlatform?: ContentPlatform;
  initialTopic?: string;
}) {
  const [platform, setPlatform] = useState<ContentPlatform>(initialPlatform ?? 'linkedin');
  const [topic, setTopic] = useState(initialTopic ?? '');
  const [sourceActionId, setSourceActionId] = useState('');
```

to:

```typescript
export function ContentStudioShell({
  clientProfileId,
  initialPieces,
  pendingActions,
  initialPlatform,
  initialTopic,
  initialSourceActionId,
}: {
  clientProfileId: string;
  initialPieces: ContentPieceView[];
  pendingActions: { id: string; pageUrl: string; actionType: string }[];
  initialPlatform?: ContentPlatform;
  initialTopic?: string;
  initialSourceActionId?: string;
}) {
  const [platform, setPlatform] = useState<ContentPlatform>(initialPlatform ?? 'linkedin');
  const [topic, setTopic] = useState(initialTopic ?? '');
  const [sourceActionId, setSourceActionId] = useState(initialSourceActionId ?? '');
```

- [ ] **Step 2: Rewrite `studio/page.tsx` to resolve via `resolveWebsiteForRequest` and accept `websiteId`/`actionId`**

Replace the full file with:

```tsx
// src/app/studio/page.tsx
import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { db } from '@/lib/db';
import { UtilityBar } from '@/components/app-shell/utility-bar';
import { ContentStudioShell, type ContentPieceView } from '@/components/content-studio/content-studio-shell';
import { ALL_PLATFORMS } from '@/lib/content-studio/registry';
import type { ContentPlatform } from '@prisma/client';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: { websiteId?: string; actionId?: string; platform?: string; topic?: string };
}) {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, searchParams.websiteId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) return notFound();
    throw err;
  }

  const clientProfile = await db.clientProfile.findFirst({ where: { id: website.clientProfileId } });
  if (!clientProfile) return null;

  const [pieces, pendingActions] = await Promise.all([
    db.contentPiece.findMany({
      where: { clientProfileId: clientProfile.id },
      orderBy: { createdAt: 'desc' },
    }),
    db.action.findMany({
      where: { websiteId: website.id, status: 'pending' },
      select: { id: true, pageUrl: true, actionType: true },
      take: 50,
    }),
  ]);

  const initialPlatform = ALL_PLATFORMS.includes(searchParams.platform as ContentPlatform)
    ? (searchParams.platform as ContentPlatform)
    : undefined;

  const initialSourceActionId = pendingActions.some((a) => a.id === searchParams.actionId)
    ? searchParams.actionId
    : undefined;

  return (
    <div className="flex flex-col gap-6 p-6">
      <UtilityBar
        websiteUrl={website.url}
        gscConnected={Boolean(website.gscRefreshToken)}
        lastRefresh={null}
      />
      <ContentStudioShell
        clientProfileId={clientProfile.id}
        initialPieces={pieces as unknown as ContentPieceView[]}
        pendingActions={pendingActions}
        initialPlatform={initialPlatform}
        initialTopic={searchParams.topic}
        initialSourceActionId={initialSourceActionId}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Build**

Run: `npx next build`
Expected: PASS (confirms the RSC page and its new `searchParams` shape compile)

- [ ] **Step 5: Commit**

```bash
git add src/app/studio/page.tsx src/components/content-studio/content-studio-shell.tsx
git commit -m "$(cat <<'EOF'
fix: resolve Studio's website via resolveWebsiteForRequest, prefill finding context

Studio previously always opened the customer's default website via
ensureCustomer, so a finding from a non-default site always opened Studio
scoped to the wrong site. It now accepts websiteId/actionId query params
and pre-fills the linked-finding selector instead of requiring manual entry.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 5: Dashboard `AttentionList` — suggested-platform links into Studio

**Files:**
- Modify: `src/components/dashboard/attention-list.tsx`

**Interfaces:**
- Consumes: `PlatformIcon` (Task 1), `suggestChannelsForAction` (Task 3).
- `AttentionAction` gains `actionType: string` and `websiteId: string` — both already present at runtime today (the sole call site, `src/app/dashboard/[websiteId]/page.tsx:294`, queries full `Action` rows via `db.action.findMany({ include: { guardResult: true }, ... })` with no `select`, so both columns are already on every row returned there; only the TypeScript interface needs widening).

No existing test file for this component, and no `.tsx` component test exists anywhere in this codebase yet (checked) besides `platform-icon.test.tsx` from Task 1 — consistent with the spec's "no new test harness" stance for UI components. Verified by `tsc` + `next build` + manual smoke check (Task 6).

- [ ] **Step 1: Replace the file**

The row was previously one whole-row `<Link>`. Suggested-platform icons need their own `<Link>`s, and nesting an `<a>` inside another `<a>` is invalid HTML — the row becomes a `<div>` with two sibling regions instead: an inner `<Link>` for the page-URL/timestamp text, and a group of per-suggestion `<Link>`s next to it.

```tsx
// src/components/dashboard/attention-list.tsx
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OUTCOME_LABEL, OUTCOME_VARIANT } from '@/lib/guard-outcome-ui';
import { formatRelativeTime } from '@/lib/dashboard-stats';
import { PlatformIcon } from '@/components/content-studio/platform-icon';
import { suggestChannelsForAction } from '@/lib/content-studio/suggest-channels';

export interface AttentionAction {
  id: string;
  pageUrl: string;
  createdAt: Date;
  guardResult: { outcome: string } | null;
  actionType: string;
  websiteId: string;
}

const ATTENTION_LIMIT = 5;

export function AttentionList({ actions }: { actions: AttentionAction[] }) {
  const top = actions.slice(0, ATTENTION_LIMIT);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Needs your attention</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        {top.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending review.</p>}
        {top.map((action) => {
          const suggestions = suggestChannelsForAction(action.actionType);
          return (
            <div
              key={action.id}
              className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
            >
              <Link
                href={`?tab=review&actionId=${action.id}`}
                scroll={false}
                className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="truncate text-sm text-foreground">{action.pageUrl}</p>
                <p className="text-xs text-muted-foreground">{formatRelativeTime(action.createdAt)}</p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {suggestions.map((s) => (
                  <Link
                    key={s.platform}
                    href={`/studio?websiteId=${action.websiteId}&actionId=${action.id}&platform=${s.platform}`}
                    title={s.rationale}
                    className="rounded p-1 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PlatformIcon platform={s.platform} size={16} />
                  </Link>
                ))}
                {action.guardResult && (
                  <Badge variant={OUTCOME_VARIANT[action.guardResult.outcome] ?? 'secondary'}>
                    {OUTCOME_LABEL[action.guardResult.outcome] ?? action.guardResult.outcome}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
        {actions.length > ATTENTION_LIMIT && (
          <Link
            href="?tab=review"
            scroll={false}
            className="mt-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            View all {actions.length} in Review Queue &rarr;
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Build**

Run: `npx next build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/attention-list.tsx
git commit -m "$(cat <<'EOF'
feat: link dashboard findings to Studio via suggested-platform icons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 6: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS, including the new `platform-icon.test.tsx` and `suggest-channels.test.ts`

- [ ] **Step 3: Full build**

Run: `npx next build`
Expected: PASS

- [ ] **Step 4: Manual smoke check in a browser**

Start the dev server (`npm run dev`), then:

1. Open `/studio` directly (no query params) — confirm it still loads against the default website, the platform `<select>` now shows a brand-colored icon+label preview beside it, and each existing draft's row shows a platform icon, its topic, and a neutral "Not connected" badge instead of a text platform label.
2. If any piece is `ready_to_publish`, confirm its "Published" button is visibly disabled and hovering it shows the "Publishing isn't connected for this platform yet." tooltip, and that "Approved" pieces can still move to "Ready to publish" normally (the real, working boundary stays clickable).
3. Open the dashboard for a website with at least one pending `meta_description` finding — confirm "Needs your attention" now shows small LinkedIn and X icons next to that row.
4. Click one of those icons — confirm it navigates to `/studio?websiteId=...&actionId=...&platform=...`, that Studio opens scoped to the correct website (not always the default), and that the "Link a pending finding" dropdown is pre-selected to that finding instead of "No linked finding".
5. If the workspace has a second website, repeat step 3-4 from that website's dashboard and confirm Studio opens scoped to the second website, not the first.

If any of these fail, fix and re-run this task's steps before considering the slice done.

- [ ] **Step 5: Update the spec's implementation status (optional but recommended)**

If this project tracks slice completion anywhere other than commit history, note Slice 2A as implemented there. No specific file is prescribed by the spec for this — skip if there is no such tracking artifact.
