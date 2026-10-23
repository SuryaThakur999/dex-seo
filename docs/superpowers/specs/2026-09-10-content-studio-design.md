# Content Studio — Design Spec (Milestone D)

## Context

Milestone D of the Dex Master Implementation Brief. Builds on Milestone B's
`Customer -> ClientProfile -> Website` schema and Milestone C's command-bar
pattern (deterministic routing, no LLM tool-calling, allowlisted server
functions). Content Studio is a drafting/export tool for social and UGC-brief
content, scoped to a `ClientProfile` (brand-level, not tied to one `Website`,
since a client's LinkedIn voice isn't a per-page concern).

**Explicitly out of scope this pass:** live publishing connectors (no OAuth to
LinkedIn/Meta/TikTok/etc. — draft and export only), asset upload/storage
(images/video are referenced by URL or left as a "needs assets" gap, not
uploaded), and content-performance tracking (no outcome window like `Action`
has — that's a different milestone if ever built).

## Architecture

```
/studio (new route)
  -> ContentStudioShell (client component: platform picker, topic form, draft list)
  -> POST /api/content-studio/drafts (generate)
  -> PATCH /api/content-studio/drafts/[id] (status transitions, edits)
  -> GET /api/content-studio/drafts/[id]/export (format for copy/download)

src/lib/content-studio/
  adapters/
    linkedin.ts, instagram.ts, facebook.ts, x.ts, reddit.ts,
    tiktok.ts, youtube.ts, ugc-brief.ts
  adapter-types.ts       (shared PlatformAdapter interface)
  registry.ts            (platform -> adapter lookup)
  draft-generator.ts     (injectable-caller LLM draft, mirrors creation-engine.ts)
  export-formatter.ts    (draft -> plain-text export blob, per adapter)

prisma/schema.prisma
  + ContentPiece model
  + ContentPlatform enum
  + ContentStatus enum
```

## Data Model

```prisma
enum ContentPlatform {
  linkedin
  instagram
  facebook
  x
  reddit
  tiktok
  youtube
  ugc_brief
}

enum ContentStatus {
  draft
  needs_assets
  needs_review
  approved
  ready_to_publish
  published
  failed
  archived
}

model ContentPiece {
  id              String          @id @default(cuid())
  clientProfileId String
  clientProfile   ClientProfile   @relation(fields: [clientProfileId], references: [id])
  platform        ContentPlatform
  topic           String
  sourceActionId  String?
  sourceAction    Action?         @relation(fields: [sourceActionId], references: [id])
  draftContent    Json
  status          ContentStatus   @default(draft)
  tokenCost       Int?
  failureReason   String?
  createdAt       DateTime        @default(now())
  decidedAt       DateTime?
}
```

`draftContent` is `Json` because each platform's shape differs (see Adapters
below) — a single flexible column beats eight near-identical tables or a
lowest-common-denominator text field that throws away structure. `ClientProfile`
and `Action` both gain a `contentPieces ContentPiece[]` back-relation.

Migration is a plain additive `prisma migrate dev` (new table + enums, one
nullable FK) — no backfill needed, unlike Milestone B's hierarchy split.
Verified against the same isolated `milestone-b-dev` Neon branch used for
Milestone B, never `.env.local`'s production `DATABASE_URL`.

## Platform Adapters

Shared interface (`adapter-types.ts`):

```ts
export interface PlatformAdapter<TDraft> {
  platform: ContentPlatform;
  label: string;
  buildPrompt(input: DraftPromptInput): string;
  parseModelOutput(raw: string): TDraft;
  validate(draft: TDraft): { valid: boolean; issues: string[] };
  formatExport(draft: TDraft): string;
}
```

`DraftPromptInput` carries `topic`, `clientProfile` (brandVoice, audience,
approvedClaims, restrictedWording, markets, languages), and optional
`sourceAction` context (pageUrl, actionType, draftContent) when the piece
originated from a finding. Every adapter's prompt includes the same
no-hallucination rule from `creation-engine.ts`: ground only in given facts,
never invent claims outside `approvedClaims`, never use wording from
`restrictedWording`.

Per-platform draft shapes (deliberately distinct, not a forced common shape):

| Platform | Shape | Notes |
|---|---|---|
| LinkedIn | `{ body, hashtags[] }` | 3000 char soft cap, professional tone |
| X | `{ body, hashtags[] }` | 280 char hard cap, `validate` rejects over-length |
| Facebook | `{ body, hashtags[] }` | 63,206 char cap (practically unbounded), casual tone |
| Instagram | `{ caption, hashtags[], altText }` | altText required for accessibility; `validate` flags missing altText as a "needs assets" signal |
| Reddit | `{ title, body, suggestedSubreddits[] }` | title separate from body; no hashtags (not a Reddit convention) |
| TikTok | `{ hook, script, captionText, hashtags[] }` | short-form video script; hook is the first-2-seconds line |
| YouTube | `{ title, description, script }` | long-form; description separate from on-screen script |
| UGC-brief | `{ brief, deliverables[], doNotSay[] }` | not a post — a brief handed to a creator; `doNotSay` is `restrictedWording` surfaced explicitly for a human, not model-enforced |

`validate()` is what can push status to `needs_assets` (missing altText,
missing deliverables) — surfaced in the UI as a badge, not a hard block on
generation.

## Generation Flow

1. User picks a `ClientProfile` (default profile pre-selected, matching the
   existing single-default-profile UX the dashboard already uses — no new
   workspace switcher, consistent with Milestones B/C not having built one
   yet), a platform, and types a topic. Optionally picks an existing pending
   `Action` to link as source context.
2. `POST /api/content-studio/drafts` — same auth/ownership check pattern as
   `command-bar/route.ts` (Clerk `userId` -> `Customer` -> owns the
   `ClientProfile`). Looks up the adapter by platform, calls
   `draft-generator.ts` with the adapter's `buildPrompt`, gets raw model text,
   parses via `adapter.parseModelOutput`, runs `adapter.validate`, creates
   the `ContentPiece` row with `status: valid ? draft : needs_assets`.
3. Draft list on `/studio` shows all `ContentPiece` rows for the selected
   profile, grouped by status (kanban-style columns matching the 8 statuses,
   collapsed to the ones with content).
4. Status transitions (`PATCH .../[id]`): `draft`/`needs_assets` ->
   `needs_review` (user marks ready) -> `approved`/`failed` (reviewer
   decision) -> `ready_to_publish` -> `published` (manual, since there's no
   live connector — this just records that the user published it themselves)
   -> `archived` any time. No implicit auto-transitions; every step is a
   deliberate user action, same "propose, never auto-execute" posture as the
   `Action` review queue.
5. Export (`GET .../[id]/export`): returns `adapter.formatExport(draftContent)`
   as plain text — what the user copies into the platform's native composer.
   No file download machinery, no platform API calls.

## Command Bar Integration

Milestone C's `intent-router.ts` left "request a content format" explicitly
deferred pending Content Studio. This milestone closes that gap: a new
`request_content` intent (e.g. "draft a linkedin post about X") routes to
`/studio?platform=linkedin&topic=X` — pre-fills the form, does not auto-generate
(generation is always an explicit user action, never fired from a text-parsed
intent, keeping the same allowlist discipline: the command bar still only ever
navigates or calls existing authorized functions, never a new code path).

## Error Handling

- Model call fails or returns empty content: `ContentPiece` created with
  `status: failed`, `failureReason` set — same fail-visibly pattern as
  `creation-engine.ts`'s `draftMetaDescription` throwing on empty content,
  except here the route catches it and persists the failure instead of
  losing the attempt (the user asked for content, they should see it failed,
  not get a silent 500).
- Adapter parse failure (model output doesn't match expected shape): treated
  as a failed draft, not a crash — `parseModelOutput` is defensive (falls back
  to putting raw text in the primary field, e.g. `body`, rather than throwing).
- Unauthorized / profile not owned by caller: 401/403, same as existing routes.

## Testing

- One test file per adapter (`adapters/*.test.ts`): prompt includes brand
  voice and approved claims, `validate` catches the platform's specific
  failure mode (X over 280 chars, Instagram missing altText, etc.),
  `formatExport` produces the expected plain-text shape.
- `draft-generator.test.ts`: injectable caller pattern (same as
  `creation-engine.ts`'s tests) — no real OpenAI calls in tests.
- Route tests for `/api/content-studio/drafts` (POST/PATCH): auth check,
  ownership check, status transition rules, failed-generation persistence.
- `intent-router.test.ts` extended with `request_content` cases.

Gate before commit, same three commands as Milestones B/C:
`npx tsc --noEmit`, `npx vitest run`, `npx next build`.
