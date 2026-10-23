# Phase 2F: Evidence-backed content (design)

Status: approved by the human on 2026-10-05 (S1-S3 and S4, including S4's schema change). Slotted after 2D and before 2E. Supersedes the drafting parts of `2026-09-10-content-studio-design.md`.

## Problem (verified in code)

| Symptom | Root cause | Location |
|---|---|---|
| Social drafts are generic | Each adapter's instruction is one line ("Write a professional, direct-tone LinkedIn post"). No hook, structure, CTA, examples, or critique pass. Single shot on `openai/gpt-oss-120b`, temperature 0.7. | `src/lib/content-studio/adapters/*.ts`, `draft-generator.ts` |
| Drafts ignore the business | `buildGroundingBlock` never passes `businessDescription`. With no approved claims, the prompt says "make no specific factual claims", which forces filler. | `src/lib/content-studio/adapter-types.ts` |
| No company or website choice | Content Studio has no website picker. | `src/components/content-studio/content-studio-shell.tsx` |
| "Linked finding" is empty or meaningless | The dropdown lists Actions, not Findings. Most Actions are SEO fixes (for example meta_description), so a social post gets "meta description for /page" as its source. | `content-studio-shell.tsx:274,420` |
| DEX data is unused | Findings, GSC queries, and page performance never reach Content Studio. | n/a |
| Marketing Memory is human-filled | No extraction step exists. `marketing-memory.ts` only reads. | `src/lib/marketing-memory.ts` |

## Positioning

DEX is not another AI writer. Every post is built from the customer's own search data, written in their brand voice, and shows why it should work. The evidence trail (query or finding, plus the ProofLayer receipt) is the differentiator.

## Slices

### S1. Fix the broken basics (no schema change)
- Website picker in Content Studio. Every draft is scoped to one website, enforced server-side through the existing ownership checks (`resolveWebsiteForRequest` pattern).
- Pass `businessDescription`, `audience`, and a short site summary into the grounding block, as trusted context, the same way `brandVoice` is passed today.
- Replace the "linked finding" dropdown with a "Built from" evidence card. It shows the real source (Finding rule and page, or GSC query with impressions/CTR). If there is no evidence, it says "From your topic, no data source" honestly.
- Acceptance:
  - Picking website A never shows website B's data.
  - The evidence card renders only persisted data.
  - Tests cover the empty-evidence state.

### S2. Copywriting engine v2 (no schema change)
- Per-platform playbooks, written using the marketing-skills library (copywriting, social-content, ai-seo):
  - A hook in the first line.
  - One structure per variant: PAS, story, or contrarian.
  - A CTA matched to the objective.
  - A platform-native format: LinkedIn post or carousel outline, X thread, Instagram caption plus visual brief, TikTok script with a 0-3s hook, YouTube title plus description, Reddit discussion-first post.
- 3 variants per request, each from a different angle.
- Draft, then critique, then revise. The critique checks hook strength, specificity, CTA, platform fit, and a banned-phrase list (AI filler).
- Final writing pass on a stronger model. The first draft can stay on the current Groq model. Target about $0.02-0.03 per post, and record the real token cost per draft in the existing tokenCost field.
- GROUNDING_RULES and ProofLayer stay unchanged. Nothing invented. Restricted wording is still enforced.
- Acceptance:
  - Golden tests with a fixed profile show each variant has a hook, a structure, and a CTA.
  - The banned-phrase check passes.
  - No fact appears that is absent from the input (assert against the fixtures).

### S3. "What will work" content opportunities (no schema change)
- Content Studio opens on a ranked list of opportunities built from real data:
  - GSC queries with high impressions and low CTR.
  - GSC queries that are rising.
  - GEO and brand Findings (for example missing entity markup, no clear answer section, unverified claims).
- Each opportunity shows the angle, the evidence (numbers plus source), and suggested channels (reuse `suggest-channels.ts`). One click creates the drafts with the evidence attached.
- Ranking rules are deterministic and inspectable. This is the same rule as the 2B Work Feed.
- Acceptance:
  - Every opportunity traces to persisted data.
  - Without a GSC connection it shows Finding-based opportunities only, with an honest note.
  - There is no fabricated "will perform" score.

### S4. AI-filled Marketing Memory (schema change, human-approved)
- On website add or rescan, DEX reads the home, about, product, and pricing pages it already crawls.
- It proposes values for `businessDescription`, `audience`, `markets`, `languages`, and `brandVoice`.
- Claims are proposed only when quoted verbatim from a crawled page, with the URL as evidence.
- Each suggestion shows "AI-suggested from [page]". The customer accepts with one click, or edits. Nothing becomes an approved claim without acceptance.
- Schema: one new table, `ProfileSuggestion`, with these fields:
  - `id`
  - `clientProfileId`
  - `websiteId`
  - `field`
  - `value`
  - `sourceUrl`
  - `sourceExcerpt`
  - `status` (`suggested` | `accepted` | `rejected`)
  - `modelVersion`
  - `promptVersion`
  - `createdAt`
  - `decidedAt`

  Accepting a suggestion writes the value into the existing `ClientProfile` field. There is no second brand-memory system (2C rule).
- Crawled content is untrusted. Extraction goes through the existing untrusted-data boundary, so page text cannot issue instructions.
- Acceptance:
  - The migration is reviewed by Dwight (schema) before it runs.
  - Every suggested claim has a sourceUrl and an excerpt that matches the page.
  - A rejected suggestion never reappears unchanged.
  - Existing manually entered profiles are untouched.
  - Marketing Memory shows where each accepted value came from.

## Order and gates
- Build order: S1, S2, S3, S4. Pam builds. Ryan reviews UI and copy-quality slices. Dwight reviews S1's ownership scoping and S4's migration and extraction boundary (one-shot each).
- Release: the master directive slice release gate, then the PRE-LIVE gate, then a Vercel preview, then the human's signed-in check, then the human runs the prod promote.
- Out of scope: auto-publishing to social platforms (Talk to Dex and Content Studio never publish), paid ads, and image generation.
