# Social Profile Discovery + Memory Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GATE — do not start Task 1 until a human has said yes to the schema pick in this doc.** God's dispatch is explicit: "Schema needs explicit human yes before any migration, same as always." This whole plan is submitted for review, not execution.

**Goal:** Dex discovers a company's own social/profile links (LinkedIn, Xing, Instagram, Facebook, X, YouTube, TikTok) during every scan, surfaces them in Settings as an editable "Your channels" list, feeds YouTube/LinkedIn/Instagram content into the existing ProfileSuggestion pipeline, and gives Studio's paste-link box an honest, platform-specific error (with a paste-text fallback) for the four platforms Dex cannot read unauthenticated.

**Architecture:** Reuses the existing ProfileSuggestion suggest/accept/reject lifecycle (already built for businessDescription/audience/markets/languages/brandVoice) for the one new fact type, rather than building a parallel review system. Discovery is deterministic HTML/JSON-LD parsing (crawler.ts), not an LLM call — a social link either is or isn't on the page; no AI judgment needed there. Studio's blocked-host handling is a pure lookup table plus one new evidence-from-text endpoint; no new fetch capability, no cookie/session scraping (out of scope by standing decision).

**Tech Stack:** Next.js App Router API routes, Prisma/Postgres, existing `src/lib/profile-suggestions.ts` + `profile-suggestion-evidence.ts` + `profile-suggestion-extractor.ts` machinery, existing `src/lib/crawler.ts` HTML-parsing helpers, existing `safe-fetch.ts` SSRF guard (unchanged — no new network capability added).

## Global Constraints

- No logged-in/cookie scraping of any platform (standing human decision + safety-classifier block) — every new fetch in this plan goes through the existing unauthenticated `safeFetch`/crawler path; nothing here adds session cookies, headless-login, or credential handling.
- Schema change is additive only (new enum value + nullable/defaulted column), and requires explicit human yes before the migration task runs.
- Accepted values never change silently — every new/updated suggestion is a `suggested`-status row the owner must accept; nothing auto-writes into `ClientProfile.socialProfiles` except an explicit accept (scan-discovered) or an explicit Settings edit (owner-direct).
- Official LinkedIn Community Management API (OAuth) and Meta/LinkedIn Ad Library (competitor paid ads) are explicitly OUT OF SCOPE for this plan — god is tracking both on the Phase 4B roadmap in board.md. Nothing in this plan should be read as a stepping stone that commits to a particular shape for either; they get their own design pass later.
- Tier 2 design rule (six skills: `emil-design-eng`, `ui-ux-pro-max`, `ui-styling`, `soft-skill`, `apple-design`, `impeccable`, tiered by change size) applies to Task 6 (Settings "Your channels" panel) and Task 7's Studio picker change — screenshots at 320/768/1280px before either is called done, same as every visual change this project ships.

---

## Schema decision

**Pick: (b) — new `ProfileSuggestionField` enum value `socialProfiles`, discovery goes through the existing suggestion lifecycle.**

Reasoning, traced against the actual code (`src/lib/profile-suggestions.ts`):

- `decideProfileSuggestion`'s accept path is `tx.clientProfile.update({ where: ..., data: { [chosen.field]: chosen.value } })` — it always writes into a `ClientProfile` column with the **same name** as the suggestion's `field`. This means picking (b) still requires adding a `socialProfiles Json @default("[]")` column on `ClientProfile` — (b) is not "enum value instead of column," it's "enum value **and** the column its accept path needs." Flagging this now so the plan doesn't under-deliver on "additive either way": both (a) and (b) end up with the same new column; the fork is only about whether *discovery* writes go through an accept gate.
- Choosing (b) over bare (a) reuses, for free, everything already built for the 5 existing fields: `suggested`/`accepted`/`rejected` status lifecycle, `sourceUrl`/`sourceExcerpt` provenance, `identity`-hash dedup (`suggestionIdentity`, with `skipDuplicates: true` on create), `modelVersion`/`promptVersion` tracking, and the existing `ProfileSuggestionsPanel` UI pattern. Building a parallel accept/reject/provenance system for just this one field (bare (a)) would be the premature-duplication this project's CLAUDE.md explicitly tells us to avoid ("check whether something in the codebase already does it — extend, don't duplicate").
- God's point 4 ("memory refresh... owner must accept the update") is **already largely built**: `run-scan.ts` (around line 764) calls `extractProfileSuggestions`/`storeProfileSuggestions` unconditionally on every scan for all profile-evidence pages, and `identity`'s hash includes the proposed value — a changed page naturally produces a new identity, hence a new `suggested` row, with `skipDuplicates` only blocking an exact repeat. Point 4 is not new infrastructure; it is "make sure `socialProfiles` proposals flow through this same already-unconditional path" (Task 8) plus one small UI addition to label a re-suggested field as an update (Task 8 also covers this — see below, no new column needed, computed at read time).
- Value shape stored in the new column: `SocialProfile[] = { platform: 'linkedin' | 'xing' | 'instagram' | 'facebook' | 'x' | 'youtube' | 'tiktok'; url: string }[]`, mirroring how `markets`/`languages` already store a whole list that gets **replaced wholesale** on accept (not merged) — same semantics, same precedent, no new merge logic to invent.
- Manual owner add/remove (god's "Your channels... owner can add/remove") does **not** go through the suggestion/accept gate — it's a direct edit, same as `markets`/`languages`/`brandVoice` are directly editable today via `PATCH /api/client-profile/[id]`. Task 5 adds a small dedicated endpoint for this (mirrors the existing `/api/client-profile/[id]/competitors` CRUD pattern for `CompetitorEntity`, which is the closest existing precedent for an owner-managed list with a `source: 'user_added' | ...'` tag).

---

## Task 1: Schema migration (GATED — human yes required before this task starts)

**Files:**
- Modify: `prisma/schema.prisma`
  - Add `socialProfiles` to `enum ProfileSuggestionField` (alongside `businessDescription`, `audience`, `markets`, `languages`, `brandVoice`).
  - Add `socialProfiles Json @default("[]")` to `model ClientProfile`.
- Create: a new Prisma migration (`npx prisma migrate dev --name add_social_profiles`).

**Interfaces:**
- Produces: `ClientProfile.socialProfiles: SocialProfile[]` (typed as `Json` in Prisma, cast at the application boundary — see Task 2) and the new enum literal, both consumed by every later task.

- [ ] **Step 1:** Add the enum literal and column to `prisma/schema.prisma` exactly as above.
- [ ] **Step 2:** Run `npx prisma migrate dev --name add_social_profiles` locally; confirm the generated SQL only adds a column with a default and an enum value (no data migration, no column drop, no NOT NULL without default).
- [ ] **Step 3:** Run `npx prisma generate` and confirm `npx tsc --noEmit` is clean.
- [ ] **Step 4:** Commit schema + migration only, no application code in this commit.

---

## Task 2: Extend suggestion-evidence validation for the new field type

**Files:**
- Modify: `src/lib/profile-suggestion-evidence.ts`
- Modify: `src/lib/profile-suggestion-evidence.test.ts`

**Interfaces:**
- Consumes: Task 1's `socialProfiles` enum literal.
- Produces: `SuggestedProfileField` widened to include `'socialProfiles'`; `ProfileSuggestionProposal.value` widened to `string | string[] | SocialProfile[]`; `validateSuggestionEvidence` accepts a `socialProfiles` proposal whose value is a deduped array of `{ platform, url }` (platform one of the 7 named ones, url a well-formed `http(s)` URL, max 20 entries — a company won't plausibly have more).

- [ ] **Step 1: Write the failing test** — `validateSuggestionEvidence` accepts a well-formed `socialProfiles` proposal and rejects a malformed one (bad platform name, non-URL `url`, duplicate platform+url pair, more than 20 entries).

```typescript
it('accepts a well-formed socialProfiles proposal', () => {
  const pages = [{ url: 'https://acme.test', text: 'Follow us on LinkedIn: https://linkedin.com/company/acme' }];
  const result = validateSuggestionEvidence({
    field: 'socialProfiles',
    value: [{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }],
    sourceUrl: 'https://acme.test',
    sourceExcerpt: 'Follow us on LinkedIn: https://linkedin.com/company/acme',
  }, pages);
  expect(result.field).toBe('socialProfiles');
  expect(result.value).toEqual([{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }]);
});

it('rejects an unknown platform name', () => {
  const pages = [{ url: 'https://acme.test', text: 'x' }];
  expect(() => validateSuggestionEvidence({
    field: 'socialProfiles', value: [{ platform: 'myspace', url: 'https://myspace.com/acme' }],
    sourceUrl: 'https://acme.test', sourceExcerpt: 'x',
  }, pages)).toThrow();
});
```

- [ ] **Step 2: Run test, confirm it fails** — `npx vitest run src/lib/profile-suggestion-evidence.test.ts` — expected failure: "Unsupported profile field" (socialProfiles not yet in `scalarFields`/`arrayFields`).
- [ ] **Step 3: Minimal implementation** — add a third category (object-array fields) alongside the existing `scalarFields`/`arrayFields` lists; validate each entry's `platform` against the 7-item allowlist and `url` via `new URL(...)` + protocol check; cap at 20 entries; dedupe on `platform+url`.
- [ ] **Step 4: Run test, confirm it passes.**
- [ ] **Step 5: Commit.**

---

## Task 3: Deterministic social-link extraction from a crawled page

**Files:**
- Modify: `src/lib/crawler.ts`
- Modify: `src/lib/crawler.test.ts`

**Interfaces:**
- Produces: `export function extractSocialProfileLinks(html: string, baseUrl: string): { platform: SocialPlatform; url: string }[]` — parses `<a href>` anchors (not scoped to footer/header specifically in markup terms, since semantic `<footer>`/`<header>` tags aren't guaranteed; matches by **host allowlist** instead, which is robust regardless of where the link sits on the page) plus any `<script type="application/ld+json">` block's `sameAs` array. Returns deduped `{platform, url}` pairs for hosts matching: `linkedin.com`, `xing.com`, `instagram.com`, `facebook.com`, `x.com`/`twitter.com` (both map to platform `'x'`), `youtube.com`/`youtu.be` (platform `'youtube'`), `tiktok.com`.

- [ ] **Step 1: Write the failing test** — HTML with a footer anchor to a LinkedIn company page and a JSON-LD `sameAs` array containing an Instagram URL both get extracted; an unrelated external link (e.g. a blog's source citation) does not.

```typescript
it('extracts social links from anchors and JSON-LD sameAs, ignoring unrelated external links', () => {
  const html = `
    <footer><a href="https://www.linkedin.com/company/acme">LinkedIn</a><a href="https://unrelated-blog.test/post">Source</a></footer>
    <script type="application/ld+json">{"@type":"Organization","sameAs":["https://www.instagram.com/acme"]}</script>
  `;
  const links = extractSocialProfileLinks(html, 'https://acme.test');
  expect(links).toEqual(expect.arrayContaining([
    { platform: 'linkedin', url: 'https://www.linkedin.com/company/acme' },
    { platform: 'instagram', url: 'https://www.instagram.com/acme' },
  ]));
  expect(links.find((l) => l.url.includes('unrelated-blog'))).toBeUndefined();
});
```

- [ ] **Step 2: Run test, confirm it fails** — `extractSocialProfileLinks is not a function`.
- [ ] **Step 3: Minimal implementation** — reuse this file's existing HTML-parsing approach (same library/regex style already used by `extractInternalLinks`/`parsePageMeta`, don't introduce a new HTML parser dependency); host-match via `new URL(href).hostname` against the allowlist; parse any `ld+json` script tags with `JSON.parse` in a `try/catch` (malformed JSON-LD on a real page is common and must not throw), pull `sameAs` if present (string or array).
- [ ] **Step 4: Run test, confirm it passes.**
- [ ] **Step 5: Commit.**

---

## Task 4: Wire discovery into the scan, as a `socialProfiles` suggestion

**Files:**
- Modify: `src/lib/run-scan.ts`
- Modify: `src/lib/run-scan.test.ts`

**Interfaces:**
- Consumes: Task 3's `extractSocialProfileLinks`, Task 2's widened `storeProfileSuggestions` input shape.
- Produces: one `socialProfiles` proposal per scan (when any links are found), fed into the *same* `storeProfileSuggestions` call already in `run-scan.ts` (around line 764) — not a second, parallel call. The proposal's `sourceUrl` is the homepage URL; `sourceExcerpt` is a short joined string of the matched anchors/sameAs entries (needed because `validateSuggestionEvidence` requires the excerpt to appear verbatim in a crawled page's text — Task 2's object-array branch needs the same excerpt-presence check the other fields get, adapted for this field: excerpt presence is checked against the *raw HTML* page recorded in `profileEvidencePages`, not just its extracted body text, since anchors/JSON-LD live in HTML and may not survive `extractBodyText`; confirm this during Task 2/4 implementation and adjust whichever side needs it. Flagging the dependency here rather than guessing the resolution).

- [ ] **Step 1: Write the failing test** — a scan whose homepage HTML contains a LinkedIn footer link produces a `socialProfiles` `ProfileSuggestion` row via `storeProfileSuggestions`.
- [ ] **Step 2: Run test, confirm it fails** — no `socialProfiles` proposal is produced today.
- [ ] **Step 3: Minimal implementation** — after the existing `extractProfileSuggestions` call, also call `extractSocialProfileLinks` on the homepage's raw HTML (need to confirm raw HTML is still in scope at this point in `run-scan.ts`, or thread it through), build a `socialProfiles` proposal object shaped like Task 2 expects, and append it to the same `proposals` array passed to `storeProfileSuggestions` — no second DB call, no second error-handling block.
- [ ] **Step 4: Run test, confirm it passes; run full `run-scan.test.ts` suite to confirm no regression to the 5 existing fields.**
- [ ] **Step 5: Commit.**

---

## Task 5: Manual owner add/remove endpoint (bypasses the suggestion gate)

**Files:**
- Create: `src/app/api/client-profile/[id]/social-profiles/route.ts`
- Create: `src/app/api/client-profile/[id]/social-profiles/route.test.ts`

**Interfaces:**
- Produces: `PATCH /api/client-profile/[id]/social-profiles` — body `{ socialProfiles: { platform: SocialPlatform; url: string }[] }`, same ownership check pattern as `src/app/api/client-profile/[id]/competitors/route.ts` (`db.clientProfile.findFirst({ where: { id, customer: { clerkUserId: userId } } })`), validates via the same allowlist/URL/dedup/cap-20 rules as Task 2, writes the **whole array** directly to `ClientProfile.socialProfiles` (same "replace whole list" semantics as the existing markets/languages PATCH in `/api/client-profile/[id]/route.ts` — owner's Settings UI always sends the full current list back, same as that route already expects for its own list fields).

- [ ] **Step 1: Write the failing test** — `PATCH` with a valid list updates `ClientProfile.socialProfiles`; `PATCH` for a profile the caller doesn't own 403s; a malformed entry 400s.
- [ ] **Step 2: Run test, confirm it fails** — route file doesn't exist yet.
- [ ] **Step 3: Minimal implementation** — mirror `competitors/route.ts`'s auth/ownership/validation/update shape exactly; no new validation logic beyond what Task 2 already wrote (extract that validation into a small shared helper if Task 2's checks are reusable as-is — confirm during implementation rather than duplicating the allowlist in two files).
- [ ] **Step 4: Run test, confirm it passes.**
- [ ] **Step 5: Commit.**

---

## Task 6: Settings "Your channels" panel (Tier 2 design rule applies)

**Files:**
- Create: `src/components/settings/social-profiles-panel.tsx`
- Create: `src/components/settings/social-profiles-panel.test.tsx`
- Modify: `src/app/settings/page.tsx` (mount under the Marketing Memory section, pass current `ClientProfile.socialProfiles` + accepted-suggestion count as props)

**Interfaces:**
- Consumes: Task 5's PATCH endpoint; `ClientProfile.socialProfiles` read in `settings/page.tsx`'s existing `clientProfile` query (add the field to its `select`).
- Produces: `SocialProfilesPanel({ clientProfileId, profiles }: { clientProfileId: string; profiles: { platform: SocialPlatform; url: string }[] })` — mirrors `CompetitorListPanel`'s row-list-with-remove + small add-form pattern; platform shown as a short label/badge (not a raw enum string), "Remove" per row, an "Add a channel" mini-form (platform `<select>` of the 7 allowed values + URL input) that PATCHes the whole updated array.

- [ ] **Step 1: Write the failing test** — renders existing channels, a Remove button calls PATCH with that entry excluded, the add-form calls PATCH with the new entry appended.
- [ ] **Step 2: Run test, confirm it fails** — component doesn't exist.
- [ ] **Step 3: Minimal implementation** — follow `competitor-list-panel.tsx`'s exact state/PATCH/optimistic-update shape; no new UI primitives, reuse `Card`/`Button`/`Select` already used throughout Settings.
- [ ] **Step 4: Run test, confirm it passes.**
- [ ] **Step 5: Mount in `settings/page.tsx`.**
- [ ] **Step 6: Six-design-skill pass** (tiered — this is a small, bounded addition to an existing page, not a new page) — screenshots at 320/768/1280px. Note in the done-report which skills were used, same as every other visual change this project ships.
- [ ] **Step 7: Commit.**

---

## Task 7: Studio blocked-host detection + paste-text fallback (Tier 2 design rule applies)

**Files:**
- Create: `src/lib/social-host-block.ts`
- Create: `src/lib/social-host-block.test.ts`
- Modify: `src/app/api/content-studio/evidence-from-url/route.ts`
- Modify: `src/app/api/content-studio/evidence-from-url/route.test.ts`
- Create: `src/app/api/content-studio/evidence-from-text/route.ts`
- Create: `src/app/api/content-studio/evidence-from-text/route.test.ts`
- Modify: `src/components/content-studio/evidence-source-picker.tsx`
- Modify: `src/components/content-studio/evidence-source-picker.test.tsx`

**Interfaces:**
- Produces: `detectBlockedSocialHost(url: string): { label: string } | null` for `linkedin.com`, `instagram.com`, `facebook.com`, `x.com`/`twitter.com`, `tiktok.com` (label e.g. `'LinkedIn'`, `'Instagram'`, ...).
- `evidence-from-url/route.ts`: checks `detectBlockedSocialHost(url)` before calling `safeFetch`/`AgentReachProvider`; on a match, returns `400` with `{ error: "${label} only shows this page to logged-in users, so Dex cannot read it. Paste the post text instead." }` — the existing generic "That URL could not be read."/"That page could not be read." messages stay as the fallback for every other failure mode (they're accurate for those cases; this is a more specific, more honest message for a known, named cause).
- `evidence-from-text/route.ts`: new owner-provided evidence source — body `{ websiteId, url, text }` (url kept as reference, not fetched), creates an `EvidenceItem` with `platform: 'owner_provided'`, `excerpt` built from `text` (same `EXCERPT_MAX_CHARS` truncation `evidence-from-url` already uses), no `safeFetch`/`AgentReachProvider` call at all (this path never fetches the blocked host — that's the whole point).
- `EvidenceSourcePicker`: when the `url`-mode fetch fails with a `detectBlockedSocialHost` match (checked client-side too, so the UI can skip the round-trip and show the textarea immediately — don't require a failed request first if the URL already matches the pattern as the owner types it), show a "Paste text instead" textarea inline (not a permanent third always-visible tab — keeps the common case, pasting a readable link, exactly as simple as it is today) that posts to `evidence-from-text`.

- [ ] **Step 1: Write the failing test** — `detectBlockedSocialHost('https://www.linkedin.com/posts/acme_123')` returns `{ label: 'LinkedIn' }`; `detectBlockedSocialHost('https://ihk.de/some-article')` returns `null` (the existing working control case, per overseer's confirmation).
- [ ] **Step 2: Run test, confirm it fails.**
- [ ] **Step 3: Minimal implementation** — host-match via `new URL(url).hostname`, same style as Task 3's allowlist (share the platform-label map between Task 3 and Task 7 if the shapes line up — confirm during implementation; don't force a shared module if the two actually need different fields).
- [ ] **Step 4: Run test, confirm it passes. Commit this piece.**
- [ ] **Step 5: Write the failing test** for `evidence-from-url/route.ts` — posting a `linkedin.com` URL now returns the specific message instead of the generic one, and does **not** call `safeFetch` (spy/assert not called) — confirms the block happens before any fetch attempt, not after a failed one (i.e., we're not relying on LinkedIn's 999 response; we check first, same safety margin as the project's SSRF-defense-in-depth style).
- [ ] **Step 6: Run test, confirm it fails. Implement the early-return check. Confirm it passes. Commit.**
- [ ] **Step 7: Write the failing test** for `evidence-from-text/route.ts` — valid `{ websiteId, url, text }` creates an `EvidenceItem` with `platform: 'owner_provided'` and the given `url`/excerpted `text`, without ever calling `safeFetch` or `AgentReachProvider`.
- [ ] **Step 8: Run test, confirm it fails (route doesn't exist). Implement. Confirm it passes. Commit.**
- [ ] **Step 9: Write the failing test** for `EvidenceSourcePicker` — pasting a `linkedin.com` URL shows the paste-text textarea with the LinkedIn-specific message, and submitting that textarea calls `evidence-from-text` with the typed text.
- [ ] **Step 10: Run test, confirm it fails. Implement. Confirm it passes. Commit.**
- [ ] **Step 11: Six-design-skill pass** for the picker change — screenshots at 320/768/1280px, name the skills used in the done-report.

---

## Task 8: Memory refresh — label a re-suggested field as an update (read-time only, no new column)

**Files:**
- Modify: `src/lib/profile-suggestions.ts`
- Modify: `src/lib/profile-suggestions.test.ts`
- Modify: `src/components/settings/profile-suggestions-panel.tsx`
- Modify: `src/components/settings/profile-suggestions-panel.test.tsx`

**Interfaces:**
- Produces: `listProfileSuggestions` additionally returns, per suggestion, whether an `accepted` row already exists for the same `(clientProfileId, field)` with an earlier `decidedAt` — computed via one extra indexed query (`@@index([clientProfileId, status])` already exists, so this is cheap), not a new column. `ProfileSuggestionsPanel` shows "Updated from `<sourceUrl>`" instead of the default "New suggestion" framing when that's true.
- This applies to **every** field, not just `socialProfiles` — point 4 of the dispatch describes general memory-refresh behavior; `socialProfiles` is simply the first field this plan adds, and the existing 5 fields get the same honest "this is an update, not new information" framing for free, since the underlying re-propose-on-change mechanism (identity hash + `skipDuplicates`) already fires for all of them today — they just never had the "Updated from" label because nothing read for it.

- [ ] **Step 1: Write the failing test** — `listProfileSuggestions` marks a `suggested` row `isUpdate: true` when an `accepted` row exists for the same field, and `isUpdate: false` for a field's first-ever suggestion.
- [ ] **Step 2: Run test, confirm it fails** — field doesn't exist on the return shape today.
- [ ] **Step 3: Minimal implementation** — one additional `findMany`/`groupBy` for `accepted` rows scoped to the same `clientProfileId`, keyed by `field`; attach the boolean in application code (no schema change).
- [ ] **Step 4: Run test, confirm it passes.**
- [ ] **Step 5: Write the failing test** for the panel — an `isUpdate: true` suggestion renders "Updated from `<sourceUrl>`"; `isUpdate: false` renders the existing copy unchanged.
- [ ] **Step 6: Run test, confirm it fails. Implement. Confirm it passes.**
- [ ] **Step 7: Commit.**

---

## Explicitly out of scope (noted per dispatch, not designed here)

- **Official LinkedIn Community Management API** (owner OAuth, for posting/reading as the company's own authenticated identity) — god is adding this to the Phase 4B roadmap on `board.md`. Nothing in this plan's `socialProfiles` value shape or ProfileSuggestion wiring should need to change to accommodate it later; OAuth-token storage is a separate, security-reviewed design (new encrypted-credential column(s), likely its own small model — not sketched here).
- **Meta/LinkedIn Ad Library lookups for competitors' paid ads** — also Phase 4B. This is a research/evidence-gathering feature for `CompetitorEntity`, a different part of the schema than anything this plan touches; no coupling assumed.

## Self-review

- **Spec coverage:** all 5 numbered points in the dispatch map to a task above (1→7, 2→3+4+6, 3→4+7's YouTube note, 4→8, 5→"out of scope" section). Schema pick with reasoning is above the task list, as asked.
- **Placeholder scan:** no task above says "add validation" without showing the actual check; no task defers code to "similar to Task N" without giving the real shape. Task 4's excerpt-matching dependency on Task 2 is flagged explicitly as an open implementation question to resolve *during* those two tasks, not left silently unresolved — that's a real, current unknown (whether `profileEvidencePages`' recorded text is raw HTML or extracted body text at the point `extractSocialProfileLinks` would need it), not a skipped design decision.
- **Type consistency:** `SocialProfile = { platform: SocialPlatform; url: string }` is used identically in Tasks 2, 3, 4, 5, 6, 7's shared-map note. `SocialPlatform` is the same 7-value union everywhere it appears.
