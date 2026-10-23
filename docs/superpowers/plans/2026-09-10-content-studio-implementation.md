# Content Studio (Milestone D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a draft/export content-drafting tool (`/studio`) covering 8 social/UGC platforms, backed by a new `ContentPiece` model, reusing the existing injectable-caller LLM pattern from `creation-engine.ts` and the command-bar allowlist pattern from Milestone C.

**Architecture:** Platform-specific logic lives behind a shared `PlatformAdapter<TDraft>` interface (`buildPrompt`/`parseModelOutput`/`validate`/`formatExport`), looked up through a `registry.ts`. A generic `draft-generator.ts` calls whichever adapter's `buildPrompt` against an injectable OpenAI caller, mirroring `creation-engine.ts`. Routes under `/api/content-studio/drafts` own auth/ownership checks and persist results as `ContentPiece` rows with an 8-status Json-backed workflow. `/studio` is a new top-level route, not a dashboard tab.

**Tech Stack:** Next.js App Router, Prisma/Postgres (Neon), Clerk auth, `openai` npm client, Vitest (`environment: node` — no component-level tests in this codebase; UI correctness is verified by `next build` + manual smoke check, matching the existing `CommandBar` component's precedent).

## Global Constraints

- Draft/export only — no live publishing connectors, no OAuth to any platform (spec: "Explicitly out of scope this pass").
- No asset upload/storage — images/video are referenced by URL or flagged `needs_assets`, never uploaded.
- No content-performance tracking / outcome window for `ContentPiece` (unlike `Action`).
- Command bar stays deterministic pattern-matching — `request_content` only ever navigates to `/studio`, never triggers generation itself (checkpoint: "Command bar routing is deterministic pattern-matching, not an LLM with tool-calling").
- Never touch the production database directly. Schema work runs against the isolated `milestone-b-dev` Neon branch via `.env.milestone-b-dev` (gitignored, already present in repo root) — never `.env.local`'s `DATABASE_URL`.
- Single-default-profile UX — no new workspace/profile switcher this milestone, matching Milestones B/C.
- Every step every user takes on a `ContentPiece` is deliberate — no implicit auto-transitions (spec: "propose, never auto-execute" posture, same as the `Action` review queue).
- Gate before every commit that touches app code: `npx tsc --noEmit`, `npx vitest run`, `npx next build`.

---

## Task 1: Prisma schema — `ContentPiece` model + enums

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `ContentPlatform` enum (`linkedin | instagram | facebook | x | reddit | tiktok | youtube | ugc_brief`), `ContentStatus` enum (`draft | needs_assets | needs_review | approved | ready_to_publish | published | failed | archived`), `ContentPiece` model with fields `id, clientProfileId, platform, topic, sourceActionId, draftContent (Json), status, tokenCost, failureReason, createdAt, decidedAt`. Every later task's Prisma calls (`db.contentPiece.*`) depend on this.

- [ ] **Step 1: Add the enums and model**

Add after the existing `RiskTier` enum (before `model Action`), and add back-relations on `ClientProfile` and `Action`:

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

  @@index([clientProfileId])
  @@index([sourceActionId])
}
```

In `model ClientProfile`, add to the field list (after `websites Website[]`):

```prisma
  contentPieces       ContentPiece[]
```

In `model Action`, add to the field list (after `outcomeMeasuredAt DateTime?`):

```prisma
  contentPieces ContentPiece[]
```

- [ ] **Step 2: Generate and apply the migration against the isolated dev branch**

Run (never against `.env.local`'s production URL):

```bash
set -a; source .env.milestone-b-dev; set +a
npx prisma migrate dev --name add_content_studio
```

Expected: migration file created under `prisma/migrations/`, applies cleanly (additive table + enums + one nullable FK — no backfill needed), Prisma Client regenerated.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no callers reference `ContentPiece` yet, so this only validates the schema/client generation itself).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat: add ContentPiece model for Content Studio (Milestone D)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 2: Shared adapter types + grounding helper

**Files:**
- Create: `src/lib/content-studio/adapter-types.ts`
- Test: `src/lib/content-studio/adapter-types.test.ts`

**Interfaces:**
- Consumes: `ClientProfile`, `Action`, `ContentPlatform` types from `@prisma/client` (generated by Task 1).
- Produces: `DraftPromptInput` (`{ topic: string; clientProfile: Pick<ClientProfile, 'brandVoice'|'audience'|'approvedClaims'|'restrictedWording'|'markets'|'languages'>; sourceAction: SourceActionContext | null }`), `SourceActionContext` (`{ pageUrl: string; actionType: string; draftContent: string }`), `AdapterValidation` (`{ valid: boolean; issues: string[] }`), `PlatformAdapter<TDraft>` interface (`platform`, `label`, `buildPrompt(input): string`, `parseModelOutput(raw): TDraft`, `validate(draft): AdapterValidation`, `formatExport(draft): string`), `GROUNDING_RULES: string`, `buildGroundingBlock(input): string`. Every adapter in Tasks 3-10 imports these.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapter-types.test.ts
import { describe, it, expect } from 'vitest';
import { buildGroundingBlock, type DraftPromptInput } from './adapter-types';

const baseInput: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: {
    brandVoice: 'Warm, direct, no jargon',
    audience: 'Small business owners',
    approvedClaims: ['30-day money-back guarantee'],
    restrictedWording: ['guaranteed results', '#1 rated'],
    markets: ['US', 'CA'],
    languages: ['en'],
  },
  sourceAction: null,
};

describe('buildGroundingBlock', () => {
  it('includes brand voice, audience, approved claims, and restricted wording', () => {
    const block = buildGroundingBlock(baseInput);
    expect(block).toContain('Warm, direct, no jargon');
    expect(block).toContain('Small business owners');
    expect(block).toContain('30-day money-back guarantee');
    expect(block).toContain('guaranteed results');
  });

  it('omits the source-action line when sourceAction is null', () => {
    const block = buildGroundingBlock(baseInput);
    expect(block).not.toContain('Source finding');
  });

  it('includes the source-action line when sourceAction is present', () => {
    const block = buildGroundingBlock({
      ...baseInput,
      sourceAction: { pageUrl: 'https://acme.com/pricing', actionType: 'meta_description', draftContent: 'Old copy' },
    });
    expect(block).toContain('Source finding');
    expect(block).toContain('https://acme.com/pricing');
    expect(block).toContain('meta_description');
  });

  it('falls back to explicit placeholders when brand fields are empty', () => {
    const block = buildGroundingBlock({
      ...baseInput,
      clientProfile: { brandVoice: null, audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
    });
    expect(block).toContain('not specified');
    expect(block).toContain('none on file');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapter-types.test.ts`
Expected: FAIL with "Cannot find module './adapter-types'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapter-types.ts
import type { ClientProfile, ContentPlatform } from '@prisma/client';

export interface SourceActionContext {
  pageUrl: string;
  actionType: string;
  draftContent: string;
}

export interface DraftPromptInput {
  topic: string;
  clientProfile: Pick<
    ClientProfile,
    'brandVoice' | 'audience' | 'approvedClaims' | 'restrictedWording' | 'markets' | 'languages'
  >;
  sourceAction: SourceActionContext | null;
}

export interface AdapterValidation {
  valid: boolean;
  issues: string[];
}

export interface PlatformAdapter<TDraft> {
  platform: ContentPlatform;
  label: string;
  buildPrompt(input: DraftPromptInput): string;
  parseModelOutput(raw: string): TDraft;
  validate(draft: TDraft): AdapterValidation;
  formatExport(draft: TDraft): string;
}

export const GROUNDING_RULES = [
  'Base every claim ONLY on the facts given below. Never invent facts, statistics, or claims not present in them.',
  'Never use any of the restricted wording listed below, in any form.',
].join('\n');

/**
 * Shared brand/fact block every adapter's prompt includes verbatim, so the
 * no-hallucination discipline from creation-engine.ts holds across all 8
 * platforms without each adapter re-deriving it.
 */
export function buildGroundingBlock(input: DraftPromptInput): string {
  const { clientProfile, sourceAction } = input;
  const lines = [
    `Brand voice: ${clientProfile.brandVoice ?? '(not specified — keep it neutral and professional)'}`,
    `Audience: ${clientProfile.audience ?? '(not specified)'}`,
    `Markets: ${clientProfile.markets.length ? clientProfile.markets.join(', ') : '(not specified)'}`,
    `Languages: ${clientProfile.languages.length ? clientProfile.languages.join(', ') : 'English'}`,
    `Approved claims (only ones you may state as fact): ${
      clientProfile.approvedClaims.length
        ? clientProfile.approvedClaims.join('; ')
        : '(none on file — make no specific factual claims)'
    }`,
    `Restricted wording (never use): ${
      clientProfile.restrictedWording.length ? clientProfile.restrictedWording.join('; ') : '(none)'
    }`,
  ];
  if (sourceAction) {
    lines.push(
      `Source finding this content is based on: ${sourceAction.actionType} on ${sourceAction.pageUrl} — "${sourceAction.draftContent}"`
    );
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapter-types.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapter-types.ts src/lib/content-studio/adapter-types.test.ts
git commit -m "$(cat <<'EOF'
feat: shared PlatformAdapter interface + grounding block for Content Studio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 3: LinkedIn adapter

**Files:**
- Create: `src/lib/content-studio/adapters/linkedin.ts`
- Test: `src/lib/content-studio/adapters/linkedin.test.ts`

**Interfaces:**
- Consumes: `PlatformAdapter`, `DraftPromptInput`, `GROUNDING_RULES`, `buildGroundingBlock` from `../adapter-types` (Task 2).
- Produces: `LinkedInDraft` (`{ body: string; hashtags: string[] }`), `linkedinAdapter: PlatformAdapter<LinkedInDraft>`. Consumed by `registry.ts` (Task 11).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/linkedin.test.ts
import { describe, it, expect } from 'vitest';
import { linkedinAdapter } from './linkedin';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: {
    brandVoice: 'Warm, direct',
    audience: 'SMB owners',
    approvedClaims: ['30-day guarantee'],
    restrictedWording: ['#1 rated'],
    markets: ['US'],
    languages: ['en'],
  },
  sourceAction: null,
};

describe('linkedinAdapter', () => {
  it('builds a prompt with grounding rules, brand voice, and topic', () => {
    const prompt = linkedinAdapter.buildPrompt(input);
    expect(prompt).toContain('Never invent facts');
    expect(prompt).toContain('Warm, direct');
    expect(prompt).toContain('spring sale');
    expect(prompt).toContain('professional');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ body: 'Check out our spring sale.', hashtags: ['sale', 'spring'] });
    expect(linkedinAdapter.parseModelOutput(raw)).toEqual({
      body: 'Check out our spring sale.',
      hashtags: ['sale', 'spring'],
    });
  });

  it('falls back to raw text as body when model output is not valid JSON', () => {
    const raw = 'Just a plain sentence, not JSON.';
    expect(linkedinAdapter.parseModelOutput(raw)).toEqual({ body: raw, hashtags: [] });
  });

  it('flags an empty body as invalid', () => {
    const result = linkedinAdapter.validate({ body: '', hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('empty');
  });

  it('flags a body over 3000 characters as invalid', () => {
    const result = linkedinAdapter.validate({ body: 'a'.repeat(3001), hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('3000');
  });

  it('accepts a valid draft', () => {
    const result = linkedinAdapter.validate({ body: 'A fine post.', hashtags: ['sale'] });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('formats export as body plus hashtags with # prefix', () => {
    const text = linkedinAdapter.formatExport({ body: 'A fine post.', hashtags: ['sale', 'spring'] });
    expect(text).toBe('A fine post.\n\n#sale #spring');
  });

  it('formats export with no trailing hashtag line when there are none', () => {
    expect(linkedinAdapter.formatExport({ body: 'A fine post.', hashtags: [] })).toBe('A fine post.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/linkedin.test.ts`
Expected: FAIL with "Cannot find module './linkedin'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/linkedin.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface LinkedInDraft {
  body: string;
  hashtags: string[];
}

const MAX_BODY_CHARS = 3000;

export const linkedinAdapter: PlatformAdapter<LinkedInDraft> = {
  platform: 'linkedin',
  label: 'LinkedIn',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'You write a LinkedIn post for a business audience. Professional, direct tone — no hype, no emoji spam.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"body": "...", "hashtags": ["...", "..."]}',
      `Body must stay under ${MAX_BODY_CHARS} characters. 3-5 hashtags, no # prefix in the array values.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): LinkedInDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        body: typeof parsed.body === 'string' ? parsed.body : raw,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
      };
    } catch {
      return { body: raw, hashtags: [] };
    }
  },

  validate(draft: LinkedInDraft) {
    const issues: string[] = [];
    if (!draft.body.trim()) issues.push('Body is empty.');
    if (draft.body.length > MAX_BODY_CHARS) issues.push(`Body exceeds ${MAX_BODY_CHARS} characters.`);
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: LinkedInDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    return tags ? `${draft.body}\n\n${tags}` : draft.body;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/linkedin.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/linkedin.ts src/lib/content-studio/adapters/linkedin.test.ts
git commit -m "$(cat <<'EOF'
feat: LinkedIn content adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 4: X adapter

**Files:**
- Create: `src/lib/content-studio/adapters/x.ts`
- Test: `src/lib/content-studio/adapters/x.test.ts`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `XDraft` (`{ body: string; hashtags: string[] }`), `xAdapter: PlatformAdapter<XDraft>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/x.test.ts
import { describe, it, expect } from 'vitest';
import { xAdapter } from './x';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Punchy', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
};

describe('xAdapter', () => {
  it('builds a prompt mentioning the 280 character hard cap', () => {
    expect(xAdapter.buildPrompt(input)).toContain('280');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ body: 'Spring sale is live.', hashtags: ['sale'] });
    expect(xAdapter.parseModelOutput(raw)).toEqual({ body: 'Spring sale is live.', hashtags: ['sale'] });
  });

  it('falls back to raw text on invalid JSON', () => {
    expect(xAdapter.parseModelOutput('not json')).toEqual({ body: 'not json', hashtags: [] });
  });

  it('rejects a body over 280 characters', () => {
    const result = xAdapter.validate({ body: 'a'.repeat(281), hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('280');
  });

  it('accepts a body at exactly 280 characters', () => {
    const result = xAdapter.validate({ body: 'a'.repeat(280), hashtags: [] });
    expect(result.valid).toBe(true);
  });

  it('formats export as body plus hashtags', () => {
    expect(xAdapter.formatExport({ body: 'Spring sale.', hashtags: ['sale'] })).toBe('Spring sale.\n\n#sale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/x.test.ts`
Expected: FAIL with "Cannot find module './x'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/x.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface XDraft {
  body: string;
  hashtags: string[];
}

const MAX_BODY_CHARS = 280;

export const xAdapter: PlatformAdapter<XDraft> = {
  platform: 'x',
  label: 'X',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'You write a post for X (formerly Twitter). Punchy, concise, no hashtag stuffing.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"body": "...", "hashtags": ["...", "..."]}',
      `Body is a HARD CAP of ${MAX_BODY_CHARS} characters including spaces. 0-2 hashtags, no # prefix in the array values.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): XDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        body: typeof parsed.body === 'string' ? parsed.body : raw,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
      };
    } catch {
      return { body: raw, hashtags: [] };
    }
  },

  validate(draft: XDraft) {
    const issues: string[] = [];
    if (!draft.body.trim()) issues.push('Body is empty.');
    if (draft.body.length > MAX_BODY_CHARS) issues.push(`Body exceeds the ${MAX_BODY_CHARS} character hard cap.`);
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: XDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    return tags ? `${draft.body}\n\n${tags}` : draft.body;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/x.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/x.ts src/lib/content-studio/adapters/x.test.ts
git commit -m "$(cat <<'EOF'
feat: X content adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 5: Facebook adapter

**Files:**
- Create: `src/lib/content-studio/adapters/facebook.ts`
- Test: `src/lib/content-studio/adapters/facebook.test.ts`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `FacebookDraft` (`{ body: string; hashtags: string[] }`), `facebookAdapter: PlatformAdapter<FacebookDraft>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/facebook.test.ts
import { describe, it, expect } from 'vitest';
import { facebookAdapter } from './facebook';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Friendly', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
};

describe('facebookAdapter', () => {
  it('builds a prompt with a casual-tone instruction', () => {
    expect(facebookAdapter.buildPrompt(input)).toContain('casual');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ body: 'Spring sale time!', hashtags: ['sale'] });
    expect(facebookAdapter.parseModelOutput(raw)).toEqual({ body: 'Spring sale time!', hashtags: ['sale'] });
  });

  it('falls back to raw text on invalid JSON', () => {
    expect(facebookAdapter.parseModelOutput('not json')).toEqual({ body: 'not json', hashtags: [] });
  });

  it('flags an empty body as invalid', () => {
    const result = facebookAdapter.validate({ body: '', hashtags: [] });
    expect(result.valid).toBe(false);
  });

  it('accepts a very long body under the 63206 character practical cap', () => {
    const result = facebookAdapter.validate({ body: 'a'.repeat(10000), hashtags: [] });
    expect(result.valid).toBe(true);
  });

  it('rejects a body over 63206 characters', () => {
    const result = facebookAdapter.validate({ body: 'a'.repeat(63207), hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('63206');
  });

  it('formats export as body plus hashtags', () => {
    expect(facebookAdapter.formatExport({ body: 'Spring sale!', hashtags: ['sale'] })).toBe('Spring sale!\n\n#sale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/facebook.test.ts`
Expected: FAIL with "Cannot find module './facebook'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/facebook.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface FacebookDraft {
  body: string;
  hashtags: string[];
}

const MAX_BODY_CHARS = 63206;

export const facebookAdapter: PlatformAdapter<FacebookDraft> = {
  platform: 'facebook',
  label: 'Facebook',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'Write a casual, conversational Facebook post — friendlier in tone than LinkedIn.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"body": "...", "hashtags": ["...", "..."]}',
      `Body must stay under ${MAX_BODY_CHARS} characters. 0-3 hashtags, no # prefix in the array values.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): FacebookDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        body: typeof parsed.body === 'string' ? parsed.body : raw,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
      };
    } catch {
      return { body: raw, hashtags: [] };
    }
  },

  validate(draft: FacebookDraft) {
    const issues: string[] = [];
    if (!draft.body.trim()) issues.push('Body is empty.');
    if (draft.body.length > MAX_BODY_CHARS) issues.push(`Body exceeds ${MAX_BODY_CHARS} characters.`);
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: FacebookDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    return tags ? `${draft.body}\n\n${tags}` : draft.body;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/facebook.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/facebook.ts src/lib/content-studio/adapters/facebook.test.ts
git commit -m "$(cat <<'EOF'
feat: Facebook content adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 6: Instagram adapter

**Files:**
- Create: `src/lib/content-studio/adapters/instagram.ts`
- Test: `src/lib/content-studio/adapters/instagram.test.ts`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `InstagramDraft` (`{ caption: string; hashtags: string[]; altText: string }`), `instagramAdapter: PlatformAdapter<InstagramDraft>`. `validate` returning `valid: false` on missing `altText` is what routes this piece to `needs_assets` status in Task 14's POST route.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/instagram.test.ts
import { describe, it, expect } from 'vitest';
import { instagramAdapter } from './instagram';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Visual, upbeat', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
};

describe('instagramAdapter', () => {
  it('builds a prompt requiring alt text', () => {
    expect(instagramAdapter.buildPrompt(input)).toContain('altText');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ caption: 'Spring sale!', hashtags: ['sale'], altText: 'A spring sale banner.' });
    expect(instagramAdapter.parseModelOutput(raw)).toEqual({
      caption: 'Spring sale!',
      hashtags: ['sale'],
      altText: 'A spring sale banner.',
    });
  });

  it('falls back to raw text as caption on invalid JSON, with empty altText', () => {
    expect(instagramAdapter.parseModelOutput('not json')).toEqual({ caption: 'not json', hashtags: [], altText: '' });
  });

  it('flags missing alt text as invalid, for accessibility', () => {
    const result = instagramAdapter.validate({ caption: 'Spring sale!', hashtags: ['sale'], altText: '' });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('alt text');
  });

  it('flags an empty caption as invalid', () => {
    const result = instagramAdapter.validate({ caption: '', hashtags: [], altText: 'A banner.' });
    expect(result.valid).toBe(false);
  });

  it('accepts a caption with alt text present', () => {
    const result = instagramAdapter.validate({ caption: 'Spring sale!', hashtags: ['sale'], altText: 'A banner.' });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('formats export as caption, hashtags, and an alt-text note', () => {
    const text = instagramAdapter.formatExport({ caption: 'Spring sale!', hashtags: ['sale'], altText: 'A banner.' });
    expect(text).toBe('Spring sale!\n\n#sale\n\n(Alt text for accessibility: A banner.)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/instagram.test.ts`
Expected: FAIL with "Cannot find module './instagram'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/instagram.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface InstagramDraft {
  caption: string;
  hashtags: string[];
  altText: string;
}

export const instagramAdapter: PlatformAdapter<InstagramDraft> = {
  platform: 'instagram',
  label: 'Instagram',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'You write an Instagram caption. Visual, upbeat, short paragraphs or line breaks.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"caption": "...", "hashtags": ["...", "..."], "altText": "..."}',
      'altText is a plain, literal description of the image this caption goes with — required for screen-reader accessibility. 5-8 hashtags.',
    ].join('\n');
  },

  parseModelOutput(raw: string): InstagramDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        caption: typeof parsed.caption === 'string' ? parsed.caption : raw,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
        altText: typeof parsed.altText === 'string' ? parsed.altText : '',
      };
    } catch {
      return { caption: raw, hashtags: [], altText: '' };
    }
  },

  validate(draft: InstagramDraft) {
    const issues: string[] = [];
    if (!draft.caption.trim()) issues.push('Caption is empty.');
    if (!draft.altText.trim()) issues.push('Missing alt text for accessibility.');
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: InstagramDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    const parts = [draft.caption];
    if (tags) parts.push(tags);
    if (draft.altText) parts.push(`(Alt text for accessibility: ${draft.altText})`);
    return parts.join('\n\n');
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/instagram.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/instagram.ts src/lib/content-studio/adapters/instagram.test.ts
git commit -m "$(cat <<'EOF'
feat: Instagram content adapter with accessibility-required alt text

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 7: Reddit adapter

**Files:**
- Create: `src/lib/content-studio/adapters/reddit.ts`
- Test: `src/lib/content-studio/adapters/reddit.test.ts`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `RedditDraft` (`{ title: string; body: string; suggestedSubreddits: string[] }`), `redditAdapter: PlatformAdapter<RedditDraft>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/reddit.test.ts
import { describe, it, expect } from 'vitest';
import { redditAdapter } from './reddit';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Honest, no marketing-speak', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
};

describe('redditAdapter', () => {
  it('builds a prompt with no hashtag mention (not a Reddit convention)', () => {
    expect(redditAdapter.buildPrompt(input)).not.toContain('hashtag');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ title: 'Our spring sale', body: 'Details here.', suggestedSubreddits: ['smallbusiness'] });
    expect(redditAdapter.parseModelOutput(raw)).toEqual({
      title: 'Our spring sale',
      body: 'Details here.',
      suggestedSubreddits: ['smallbusiness'],
    });
  });

  it('falls back to raw text as body with an empty title on invalid JSON', () => {
    expect(redditAdapter.parseModelOutput('not json')).toEqual({ title: '', body: 'not json', suggestedSubreddits: [] });
  });

  it('flags an empty title as invalid', () => {
    const result = redditAdapter.validate({ title: '', body: 'Details.', suggestedSubreddits: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('title');
  });

  it('flags a title over 300 characters as invalid', () => {
    const result = redditAdapter.validate({ title: 'a'.repeat(301), body: 'Details.', suggestedSubreddits: [] });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid draft', () => {
    const result = redditAdapter.validate({ title: 'Our spring sale', body: 'Details.', suggestedSubreddits: [] });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('formats export as title, body, and suggested subreddits', () => {
    const text = redditAdapter.formatExport({ title: 'Our spring sale', body: 'Details here.', suggestedSubreddits: ['smallbusiness', 'retail'] });
    expect(text).toBe('Title: Our spring sale\n\nDetails here.\n\nSuggested subreddits: r/smallbusiness, r/retail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/reddit.test.ts`
Expected: FAIL with "Cannot find module './reddit'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/reddit.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface RedditDraft {
  title: string;
  body: string;
  suggestedSubreddits: string[];
}

const MAX_TITLE_CHARS = 300;

export const redditAdapter: PlatformAdapter<RedditDraft> = {
  platform: 'reddit',
  label: 'Reddit',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'You write a Reddit post. Honest, conversational, no marketing-speak — Reddit users penalize obvious ads.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"title": "...", "body": "...", "suggestedSubreddits": ["...", "..."]}',
      `Title must stay under ${MAX_TITLE_CHARS} characters. suggestedSubreddits are names only, no "r/" prefix.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): RedditDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        body: typeof parsed.body === 'string' ? parsed.body : raw,
        suggestedSubreddits: Array.isArray(parsed.suggestedSubreddits)
          ? parsed.suggestedSubreddits.filter((s: unknown) => typeof s === 'string')
          : [],
      };
    } catch {
      return { title: '', body: raw, suggestedSubreddits: [] };
    }
  },

  validate(draft: RedditDraft) {
    const issues: string[] = [];
    if (!draft.title.trim()) issues.push('A title is required.');
    if (draft.title.length > MAX_TITLE_CHARS) issues.push(`Title exceeds ${MAX_TITLE_CHARS} characters.`);
    if (!draft.body.trim()) issues.push('Body is empty.');
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: RedditDraft): string {
    const parts = [`Title: ${draft.title}`, draft.body];
    if (draft.suggestedSubreddits.length) {
      parts.push(`Suggested subreddits: ${draft.suggestedSubreddits.map((s) => `r/${s.replace(/^r\//, '')}`).join(', ')}`);
    }
    return parts.join('\n\n');
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/reddit.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/reddit.ts src/lib/content-studio/adapters/reddit.test.ts
git commit -m "$(cat <<'EOF'
feat: Reddit content adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 8: TikTok adapter

**Files:**
- Create: `src/lib/content-studio/adapters/tiktok.ts`
- Test: `src/lib/content-studio/adapters/tiktok.test.ts`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `TikTokDraft` (`{ hook: string; script: string; captionText: string; hashtags: string[] }`), `tiktokAdapter: PlatformAdapter<TikTokDraft>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/tiktok.test.ts
import { describe, it, expect } from 'vitest';
import { tiktokAdapter } from './tiktok';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Fast, fun', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
};

describe('tiktokAdapter', () => {
  it('builds a prompt describing the hook as the first-2-seconds line', () => {
    expect(tiktokAdapter.buildPrompt(input)).toContain('first 2 seconds');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ hook: 'Wait for it...', script: 'Full script here.', captionText: 'Spring sale', hashtags: ['sale'] });
    expect(tiktokAdapter.parseModelOutput(raw)).toEqual({
      hook: 'Wait for it...',
      script: 'Full script here.',
      captionText: 'Spring sale',
      hashtags: ['sale'],
    });
  });

  it('falls back to raw text as script on invalid JSON', () => {
    expect(tiktokAdapter.parseModelOutput('not json')).toEqual({ hook: '', script: 'not json', captionText: '', hashtags: [] });
  });

  it('flags an empty hook as invalid', () => {
    const result = tiktokAdapter.validate({ hook: '', script: 'Full script.', captionText: 'Sale', hashtags: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('hook');
  });

  it('flags an empty script as invalid', () => {
    const result = tiktokAdapter.validate({ hook: 'Wait for it...', script: '', captionText: 'Sale', hashtags: [] });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid draft', () => {
    const result = tiktokAdapter.validate({ hook: 'Wait for it...', script: 'Full script.', captionText: 'Sale', hashtags: [] });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('formats export as hook, script, and caption with hashtags', () => {
    const text = tiktokAdapter.formatExport({ hook: 'Wait for it...', script: 'Full script.', captionText: 'Spring sale', hashtags: ['sale'] });
    expect(text).toBe('Hook (first 2 seconds): Wait for it...\n\nScript:\nFull script.\n\nCaption: Spring sale #sale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/tiktok.test.ts`
Expected: FAIL with "Cannot find module './tiktok'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/tiktok.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface TikTokDraft {
  hook: string;
  script: string;
  captionText: string;
  hashtags: string[];
}

export const tiktokAdapter: PlatformAdapter<TikTokDraft> = {
  platform: 'tiktok',
  label: 'TikTok',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'You write a short-form TikTok video script. Fast-paced, hook-first, spoken language not written prose.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"hook": "...", "script": "...", "captionText": "...", "hashtags": ["...", "..."]}',
      'hook is the exact line spoken in the first 2 seconds — the reason someone keeps watching. script is the full spoken script. 3-5 hashtags.',
    ].join('\n');
  },

  parseModelOutput(raw: string): TikTokDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        hook: typeof parsed.hook === 'string' ? parsed.hook : '',
        script: typeof parsed.script === 'string' ? parsed.script : raw,
        captionText: typeof parsed.captionText === 'string' ? parsed.captionText : '',
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
      };
    } catch {
      return { hook: '', script: raw, captionText: '', hashtags: [] };
    }
  },

  validate(draft: TikTokDraft) {
    const issues: string[] = [];
    if (!draft.hook.trim()) issues.push('Missing the hook (first 2 seconds line).');
    if (!draft.script.trim()) issues.push('Script is empty.');
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: TikTokDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    const caption = tags ? `${draft.captionText} ${tags}`.trim() : draft.captionText;
    return `Hook (first 2 seconds): ${draft.hook}\n\nScript:\n${draft.script}\n\nCaption: ${caption}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/tiktok.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/tiktok.ts src/lib/content-studio/adapters/tiktok.test.ts
git commit -m "$(cat <<'EOF'
feat: TikTok content adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 9: YouTube adapter

**Files:**
- Create: `src/lib/content-studio/adapters/youtube.ts`
- Test: `src/lib/content-studio/adapters/youtube.test.ts`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `YouTubeDraft` (`{ title: string; description: string; script: string }`), `youtubeAdapter: PlatformAdapter<YouTubeDraft>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/youtube.test.ts
import { describe, it, expect } from 'vitest';
import { youtubeAdapter } from './youtube';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: 'Informative', audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
};

describe('youtubeAdapter', () => {
  it('builds a prompt describing description as separate from the on-screen script', () => {
    expect(youtubeAdapter.buildPrompt(input)).toContain('description');
    expect(youtubeAdapter.buildPrompt(input)).toContain('script');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({ title: 'Spring Sale Explained', description: 'Full details in this video.', script: 'Full script here.' });
    expect(youtubeAdapter.parseModelOutput(raw)).toEqual({
      title: 'Spring Sale Explained',
      description: 'Full details in this video.',
      script: 'Full script here.',
    });
  });

  it('falls back to raw text as script with an empty title on invalid JSON', () => {
    expect(youtubeAdapter.parseModelOutput('not json')).toEqual({ title: '', description: '', script: 'not json' });
  });

  it('flags an empty title as invalid', () => {
    const result = youtubeAdapter.validate({ title: '', description: 'Details.', script: 'Full script.' });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('title');
  });

  it('flags a title over 100 characters as invalid', () => {
    const result = youtubeAdapter.validate({ title: 'a'.repeat(101), description: 'Details.', script: 'Full script.' });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid draft', () => {
    const result = youtubeAdapter.validate({ title: 'Spring Sale Explained', description: 'Details.', script: 'Full script.' });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('formats export as title, description, and script', () => {
    const text = youtubeAdapter.formatExport({ title: 'Spring Sale Explained', description: 'Full details.', script: 'Full script.' });
    expect(text).toBe('Title: Spring Sale Explained\n\nDescription:\nFull details.\n\nScript:\nFull script.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/youtube.test.ts`
Expected: FAIL with "Cannot find module './youtube'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/youtube.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface YouTubeDraft {
  title: string;
  description: string;
  script: string;
}

const MAX_TITLE_CHARS = 100;

export const youtubeAdapter: PlatformAdapter<YouTubeDraft> = {
  platform: 'youtube',
  label: 'YouTube',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'You write a long-form YouTube video: a title, an SEO-minded description, and a spoken script.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"title": "...", "description": "...", "script": "..."}',
      `title stays under ${MAX_TITLE_CHARS} characters. description is what viewers read below the video, separate from script, which is what gets spoken on screen.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): YouTubeDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        script: typeof parsed.script === 'string' ? parsed.script : raw,
      };
    } catch {
      return { title: '', description: '', script: raw };
    }
  },

  validate(draft: YouTubeDraft) {
    const issues: string[] = [];
    if (!draft.title.trim()) issues.push('A title is required.');
    if (draft.title.length > MAX_TITLE_CHARS) issues.push(`Title exceeds ${MAX_TITLE_CHARS} characters.`);
    if (!draft.script.trim()) issues.push('Script is empty.');
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: YouTubeDraft): string {
    return `Title: ${draft.title}\n\nDescription:\n${draft.description}\n\nScript:\n${draft.script}`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/youtube.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/youtube.ts src/lib/content-studio/adapters/youtube.test.ts
git commit -m "$(cat <<'EOF'
feat: YouTube content adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 10: UGC-brief adapter

**Files:**
- Create: `src/lib/content-studio/adapters/ugc-brief.ts`
- Test: `src/lib/content-studio/adapters/ugc-brief.test.ts`

**Interfaces:**
- Consumes: same as Task 3.
- Produces: `UgcBriefDraft` (`{ brief: string; deliverables: string[]; doNotSay: string[] }`), `ugcBriefAdapter: PlatformAdapter<UgcBriefDraft>`. `validate` returning `valid: false` on empty `deliverables` is what routes this piece to `needs_assets` status in Task 14.
- **Design note:** the spec calls `doNotSay` "`restrictedWording` surfaced explicitly for a human, not model-enforced." Since `parseModelOutput(raw: string)` has no access to `clientProfile` (only the model's raw text, per the shared `PlatformAdapter` interface locked in Task 2), this adapter's prompt explicitly instructs the model to copy the given restricted-wording list verbatim into `doNotSay` — the human reviewer at the `needs_review` gate is still the actual enforcement point, matching the spec's intent without changing the adapter interface for one field.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/adapters/ugc-brief.test.ts
import { describe, it, expect } from 'vitest';
import { ugcBriefAdapter } from './ugc-brief';
import type { DraftPromptInput } from '../adapter-types';

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: {
    brandVoice: 'Authentic',
    audience: null,
    approvedClaims: [],
    restrictedWording: ['guaranteed results'],
    markets: [],
    languages: [],
  },
  sourceAction: null,
};

describe('ugcBriefAdapter', () => {
  it('builds a prompt instructing the model to copy restricted wording verbatim into doNotSay', () => {
    const prompt = ugcBriefAdapter.buildPrompt(input);
    expect(prompt).toContain('doNotSay');
    expect(prompt).toContain('verbatim');
  });

  it('parses valid JSON model output', () => {
    const raw = JSON.stringify({
      brief: 'Show the product in daily use.',
      deliverables: ['1x 30-second video', '3x photos'],
      doNotSay: ['guaranteed results'],
    });
    expect(ugcBriefAdapter.parseModelOutput(raw)).toEqual({
      brief: 'Show the product in daily use.',
      deliverables: ['1x 30-second video', '3x photos'],
      doNotSay: ['guaranteed results'],
    });
  });

  it('falls back to raw text as brief on invalid JSON', () => {
    expect(ugcBriefAdapter.parseModelOutput('not json')).toEqual({ brief: 'not json', deliverables: [], doNotSay: [] });
  });

  it('flags empty deliverables as invalid, needing assets', () => {
    const result = ugcBriefAdapter.validate({ brief: 'Show the product.', deliverables: [], doNotSay: [] });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('deliverables');
  });

  it('flags an empty brief as invalid', () => {
    const result = ugcBriefAdapter.validate({ brief: '', deliverables: ['1x video'], doNotSay: [] });
    expect(result.valid).toBe(false);
  });

  it('accepts a valid draft', () => {
    const result = ugcBriefAdapter.validate({ brief: 'Show the product.', deliverables: ['1x video'], doNotSay: [] });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('formats export as brief, deliverables list, and do-not-say list', () => {
    const text = ugcBriefAdapter.formatExport({
      brief: 'Show the product in daily use.',
      deliverables: ['1x 30-second video', '3x photos'],
      doNotSay: ['guaranteed results'],
    });
    expect(text).toBe(
      'Brief:\nShow the product in daily use.\n\nDeliverables:\n- 1x 30-second video\n- 3x photos\n\nDo NOT say:\n- guaranteed results'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/adapters/ugc-brief.test.ts`
Expected: FAIL with "Cannot find module './ugc-brief'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/adapters/ugc-brief.ts
import type { PlatformAdapter, DraftPromptInput } from '../adapter-types';
import { GROUNDING_RULES, buildGroundingBlock } from '../adapter-types';

export interface UgcBriefDraft {
  brief: string;
  deliverables: string[];
  doNotSay: string[];
}

export const ugcBriefAdapter: PlatformAdapter<UgcBriefDraft> = {
  platform: 'ugc_brief',
  label: 'UGC Brief',

  buildPrompt(input: DraftPromptInput): string {
    return [
      'You write a brief handed to a content creator — this is not a post, it is instructions for a human.',
      GROUNDING_RULES,
      '',
      buildGroundingBlock(input),
      '',
      `Topic: ${input.topic}`,
      '',
      'Output as JSON only, no markdown fences: {"brief": "...", "deliverables": ["...", "..."], "doNotSay": ["...", "..."]}',
      'brief explains the concept and goal in plain language. deliverables lists exactly what the creator must produce (e.g. "1x 30-second video"). doNotSay must copy the Restricted wording list above verbatim, one entry per array item — do not paraphrase or omit any of them.',
    ].join('\n');
  },

  parseModelOutput(raw: string): UgcBriefDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        brief: typeof parsed.brief === 'string' ? parsed.brief : raw,
        deliverables: Array.isArray(parsed.deliverables)
          ? parsed.deliverables.filter((d: unknown) => typeof d === 'string')
          : [],
        doNotSay: Array.isArray(parsed.doNotSay) ? parsed.doNotSay.filter((d: unknown) => typeof d === 'string') : [],
      };
    } catch {
      return { brief: raw, deliverables: [], doNotSay: [] };
    }
  },

  validate(draft: UgcBriefDraft) {
    const issues: string[] = [];
    if (!draft.brief.trim()) issues.push('Brief is empty.');
    if (draft.deliverables.length === 0) issues.push('No deliverables specified.');
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: UgcBriefDraft): string {
    const parts = [`Brief:\n${draft.brief}`, `Deliverables:\n${draft.deliverables.map((d) => `- ${d}`).join('\n')}`];
    if (draft.doNotSay.length) {
      parts.push(`Do NOT say:\n${draft.doNotSay.map((d) => `- ${d}`).join('\n')}`);
    }
    return parts.join('\n\n');
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/adapters/ugc-brief.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/adapters/ugc-brief.ts src/lib/content-studio/adapters/ugc-brief.test.ts
git commit -m "$(cat <<'EOF'
feat: UGC-brief content adapter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 11: Adapter registry

**Files:**
- Create: `src/lib/content-studio/registry.ts`
- Test: `src/lib/content-studio/registry.test.ts`

**Interfaces:**
- Consumes: all 8 adapters from Tasks 3-10 (`linkedinAdapter`, `xAdapter`, `facebookAdapter`, `instagramAdapter`, `redditAdapter`, `tiktokAdapter`, `youtubeAdapter`, `ugcBriefAdapter`), `ContentPlatform` from `@prisma/client`.
- Produces: `getAdapter(platform: ContentPlatform): PlatformAdapter<unknown>`, `listAdapters(): PlatformAdapter<unknown>[]`. Consumed by `draft-generator.ts` callers (routes in Task 14) and `export-formatter.ts` (Task 13).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/registry.test.ts
import { describe, it, expect } from 'vitest';
import { getAdapter, listAdapters } from './registry';

describe('content studio registry', () => {
  it('resolves each of the 8 platforms to an adapter with a matching platform field', () => {
    const platforms = ['linkedin', 'instagram', 'facebook', 'x', 'reddit', 'tiktok', 'youtube', 'ugc_brief'] as const;
    for (const platform of platforms) {
      expect(getAdapter(platform).platform).toBe(platform);
    }
  });

  it('lists all 8 adapters', () => {
    expect(listAdapters()).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/registry.test.ts`
Expected: FAIL with "Cannot find module './registry'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/registry.ts
import type { ContentPlatform } from '@prisma/client';
import type { PlatformAdapter } from './adapter-types';
import { linkedinAdapter } from './adapters/linkedin';
import { xAdapter } from './adapters/x';
import { facebookAdapter } from './adapters/facebook';
import { instagramAdapter } from './adapters/instagram';
import { redditAdapter } from './adapters/reddit';
import { tiktokAdapter } from './adapters/tiktok';
import { youtubeAdapter } from './adapters/youtube';
import { ugcBriefAdapter } from './adapters/ugc-brief';

const REGISTRY: Record<ContentPlatform, PlatformAdapter<unknown>> = {
  linkedin: linkedinAdapter as PlatformAdapter<unknown>,
  x: xAdapter as PlatformAdapter<unknown>,
  facebook: facebookAdapter as PlatformAdapter<unknown>,
  instagram: instagramAdapter as PlatformAdapter<unknown>,
  reddit: redditAdapter as PlatformAdapter<unknown>,
  tiktok: tiktokAdapter as PlatformAdapter<unknown>,
  youtube: youtubeAdapter as PlatformAdapter<unknown>,
  ugc_brief: ugcBriefAdapter as PlatformAdapter<unknown>,
};

export function getAdapter(platform: ContentPlatform): PlatformAdapter<unknown> {
  return REGISTRY[platform];
}

export function listAdapters(): PlatformAdapter<unknown>[] {
  return Object.values(REGISTRY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/registry.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/registry.ts src/lib/content-studio/registry.test.ts
git commit -m "$(cat <<'EOF'
feat: platform adapter registry for Content Studio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 12: Draft generator (injectable-caller LLM call)

**Files:**
- Create: `src/lib/content-studio/draft-generator.ts`
- Test: `src/lib/content-studio/draft-generator.test.ts`

**Interfaces:**
- Consumes: `PlatformAdapter<TDraft>`, `DraftPromptInput` from `./adapter-types` (Task 2). Uses the `openai` npm package (already a project dependency, same as `creation-engine.ts`).
- Produces: `generateContentDraft<TDraft>(adapter: PlatformAdapter<TDraft>, input: DraftPromptInput, callOpenAI?: OpenAICaller): Promise<{ draft: TDraft; tokenCost: number }>`, throws `Error` when the model returns empty content. Consumed by the POST route in Task 14.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/draft-generator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateContentDraft } from './draft-generator';
import type { PlatformAdapter, DraftPromptInput } from './adapter-types';

interface FakeDraft {
  body: string;
}

const fakeAdapter: PlatformAdapter<FakeDraft> = {
  platform: 'linkedin',
  label: 'Fake',
  buildPrompt: (input) => `PROMPT for ${input.topic}`,
  parseModelOutput: (raw) => ({ body: raw }),
  validate: () => ({ valid: true, issues: [] }),
  formatExport: (draft) => draft.body,
};

const input: DraftPromptInput = {
  topic: 'spring sale',
  clientProfile: { brandVoice: null, audience: null, approvedClaims: [], restrictedWording: [], markets: [], languages: [] },
  sourceAction: null,
};

describe('generateContentDraft', () => {
  it('sends the adapter-built prompt to the injected caller and parses the result', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'Spring sale copy.', totalTokens: 42 });

    const result = await generateContentDraft(fakeAdapter, input, callOpenAI);

    expect(callOpenAI).toHaveBeenCalledWith('PROMPT for spring sale');
    expect(result).toEqual({ draft: { body: 'Spring sale copy.' }, tokenCost: 42 });
  });

  it('throws if the model returns empty content', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '', totalTokens: 5 });

    await expect(generateContentDraft(fakeAdapter, input, callOpenAI)).rejects.toThrow('empty draft');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/draft-generator.test.ts`
Expected: FAIL with "Cannot find module './draft-generator'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/draft-generator.ts
import OpenAI from 'openai';
import type { DraftPromptInput, PlatformAdapter } from './adapter-types';

export interface ContentDraftResult<TDraft> {
  draft: TDraft;
  tokenCost: number;
}

type OpenAICaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = 'openai/gpt-oss-120b';

async function defaultCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    timeout: 15_000,
    maxRetries: 1,
  });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function generateContentDraft<TDraft>(
  adapter: PlatformAdapter<TDraft>,
  input: DraftPromptInput,
  callOpenAI: OpenAICaller = defaultCaller
): Promise<ContentDraftResult<TDraft>> {
  const prompt = adapter.buildPrompt(input);
  const { content, totalTokens } = await callOpenAI(prompt);
  if (!content) {
    throw new Error(`Model returned an empty draft for ${adapter.platform} (topic: ${input.topic})`);
  }
  const draft = adapter.parseModelOutput(content);
  return { draft, tokenCost: totalTokens };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/draft-generator.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/draft-generator.ts src/lib/content-studio/draft-generator.test.ts
git commit -m "$(cat <<'EOF'
feat: injectable-caller draft generator for Content Studio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 13: Export formatter

**Files:**
- Create: `src/lib/content-studio/export-formatter.ts`
- Test: `src/lib/content-studio/export-formatter.test.ts`

**Interfaces:**
- Consumes: `getAdapter` from `./registry` (Task 11), `ContentPlatform` from `@prisma/client`.
- Produces: `formatContentExport(platform: ContentPlatform, draftContent: unknown): string`. Consumed by the export route in Task 16.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/content-studio/export-formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatContentExport } from './export-formatter';

describe('formatContentExport', () => {
  it('dispatches to the LinkedIn adapter for a linkedin draft', () => {
    const text = formatContentExport('linkedin', { body: 'A fine post.', hashtags: ['sale'] });
    expect(text).toBe('A fine post.\n\n#sale');
  });

  it('dispatches to the Reddit adapter for a reddit draft', () => {
    const text = formatContentExport('reddit', { title: 'Our sale', body: 'Details.', suggestedSubreddits: [] });
    expect(text).toBe('Title: Our sale\n\nDetails.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/content-studio/export-formatter.test.ts`
Expected: FAIL with "Cannot find module './export-formatter'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/content-studio/export-formatter.ts
import type { ContentPlatform } from '@prisma/client';
import { getAdapter } from './registry';

export function formatContentExport(platform: ContentPlatform, draftContent: unknown): string {
  const adapter = getAdapter(platform);
  return adapter.formatExport(draftContent as never);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/content-studio/export-formatter.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/export-formatter.ts src/lib/content-studio/export-formatter.test.ts
git commit -m "$(cat <<'EOF'
feat: export formatter dispatching to platform adapters

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 14: `POST` + `GET /api/content-studio/drafts`

**Files:**
- Create: `src/app/api/content-studio/drafts/route.ts`
- Test: `src/app/api/content-studio/drafts/route.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `auth` from `@clerk/nextjs/server`, `getAdapter` from `@/lib/content-studio/registry` (Task 11), `generateContentDraft` from `@/lib/content-studio/draft-generator` (Task 12), `DraftPromptInput` from `@/lib/content-studio/adapter-types` (Task 2), `ContentPlatform` from `@prisma/client`.
- Produces: `POST` handler (creates a `ContentPiece`, `status: 'draft' | 'needs_assets' | 'failed'`), `GET` handler (lists `ContentPiece` rows for a `clientProfileId`). Consumed by `ContentStudioShell` (Task 18).

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/content-studio/drafts/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST, GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { getAdapter } from '@/lib/content-studio/registry';
import { generateContentDraft } from '@/lib/content-studio/draft-generator';

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findFirst: vi.fn() },
    action: { findFirst: vi.fn() },
    contentPiece: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/content-studio/registry', () => ({ getAdapter: vi.fn() }));

vi.mock('@/lib/content-studio/draft-generator', () => ({ generateContentDraft: vi.fn() }));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeGetRequest(clientProfileId: string): NextRequest {
  return new Request(`http://localhost:3000/api/content-studio/drafts?clientProfileId=${clientProfileId}`) as unknown as NextRequest;
}

const profile = {
  id: 'profile_1',
  brandVoice: 'Warm',
  audience: 'SMBs',
  approvedClaims: [],
  restrictedWording: [],
  markets: [],
  languages: [],
};

describe('POST /api/content-studio/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 when topic is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: '' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown platform', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'myspace', topic: 'spring sale' }));

    expect(res.status).toBe(400);
  });

  it('returns 403 when the client profile is not owned by the caller', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));

    expect(res.status).toBe(403);
  });

  it('creates a draft-status ContentPiece when generation and validation succeed', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(profile);
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      platform: 'linkedin',
      validate: () => ({ valid: true, issues: [] }),
    });
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { body: 'Spring sale copy.', hashtags: [] },
      tokenCost: 50,
    });
    (db.contentPiece.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));

    expect(db.contentPiece.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'draft', tokenCost: 50 }) })
    );
    expect(res.status).toBe(200);
  });

  it('creates a needs_assets-status ContentPiece when validation fails', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(profile);
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
      platform: 'instagram',
      validate: () => ({ valid: false, issues: ['Missing alt text.'] }),
    });
    (generateContentDraft as ReturnType<typeof vi.fn>).mockResolvedValue({
      draft: { caption: 'Sale', hashtags: [], altText: '' },
      tokenCost: 30,
    });
    (db.contentPiece.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_2', status: 'needs_assets' });

    await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'instagram', topic: 'spring sale' }));

    expect(db.contentPiece.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'needs_assets' }) })
    );
  });

  it('persists a failed-status ContentPiece instead of returning a 500 when generation throws', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(profile);
    (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({ platform: 'linkedin', validate: () => ({ valid: true, issues: [] }) });
    (generateContentDraft as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Model returned an empty draft'));
    (db.contentPiece.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_3', status: 'failed' });

    const res = await POST(makePostRequest({ clientProfileId: 'profile_1', platform: 'linkedin', topic: 'spring sale' }));

    expect(db.contentPiece.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', failureReason: 'Model returned an empty draft' }),
      })
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/content-studio/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeGetRequest('profile_1'));

    expect(res.status).toBe(401);
  });

  it('returns 403 when the client profile is not owned by the caller', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET(makeGetRequest('profile_1'));

    expect(res.status).toBe(403);
  });

  it('lists content pieces for an owned profile, newest first', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.contentPiece.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'piece_1' }]);

    const res = await GET(makeGetRequest('profile_1'));
    const body = await res.json();

    expect(db.contentPiece.findMany).toHaveBeenCalledWith({
      where: { clientProfileId: 'profile_1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(body).toEqual([{ id: 'piece_1' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/content-studio/drafts/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/content-studio/drafts/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdapter } from '@/lib/content-studio/registry';
import { generateContentDraft } from '@/lib/content-studio/draft-generator';
import type { DraftPromptInput } from '@/lib/content-studio/adapter-types';
import type { ContentPlatform } from '@prisma/client';

const VALID_PLATFORMS: ContentPlatform[] = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'reddit',
  'tiktok',
  'youtube',
  'ugc_brief',
];

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const { clientProfileId, platform, topic, sourceActionId } = body;

  if (typeof clientProfileId !== 'string' || typeof topic !== 'string' || !topic.trim()) {
    return NextResponse.json({ error: 'clientProfileId and topic are required' }, { status: 400 });
  }
  if (!VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  }

  const clientProfile = await db.clientProfile.findFirst({
    where: { id: clientProfileId, customer: { clerkUserId: userId } },
    select: {
      id: true,
      brandVoice: true,
      audience: true,
      approvedClaims: true,
      restrictedWording: true,
      markets: true,
      languages: true,
    },
  });
  if (!clientProfile) {
    return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });
  }

  let sourceAction: DraftPromptInput['sourceAction'] = null;
  if (typeof sourceActionId === 'string' && sourceActionId) {
    const action = await db.action.findFirst({
      where: { id: sourceActionId, customer: { clerkUserId: userId } },
      select: { pageUrl: true, actionType: true, draftContent: true },
    });
    if (!action) {
      return NextResponse.json({ error: 'Source action not found' }, { status: 403 });
    }
    sourceAction = action;
  }

  const adapter = getAdapter(platform as ContentPlatform);
  const input: DraftPromptInput = { topic, clientProfile, sourceAction };

  try {
    const { draft, tokenCost } = await generateContentDraft(adapter, input);
    const validation = adapter.validate(draft);
    const piece = await db.contentPiece.create({
      data: {
        clientProfileId,
        platform: platform as ContentPlatform,
        topic,
        sourceActionId: sourceActionId || null,
        draftContent: draft as never,
        status: validation.valid ? 'draft' : 'needs_assets',
        tokenCost,
      },
    });
    return NextResponse.json(piece);
  } catch (err) {
    const piece = await db.contentPiece.create({
      data: {
        clientProfileId,
        platform: platform as ContentPlatform,
        topic,
        sourceActionId: sourceActionId || null,
        draftContent: {},
        status: 'failed',
        failureReason: err instanceof Error ? err.message : 'Generation failed',
      },
    });
    return NextResponse.json(piece);
  }
}

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const clientProfileId = req.nextUrl.searchParams.get('clientProfileId');
  if (!clientProfileId) {
    return NextResponse.json({ error: 'clientProfileId is required' }, { status: 400 });
  }

  const clientProfile = await db.clientProfile.findFirst({
    where: { id: clientProfileId, customer: { clerkUserId: userId } },
    select: { id: true },
  });
  if (!clientProfile) {
    return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });
  }

  const pieces = await db.contentPiece.findMany({
    where: { clientProfileId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(pieces);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/content-studio/drafts/route.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Add the route to Clerk's protected routes**

In `src/middleware.ts`, the `createRouteMatcher` array currently reads:

```typescript
const isProtectedRoute = createRouteMatcher([
  '/dashboard(/.*)?',
  '/review(.*)',
  '/settings(.*)',
  '/api/gsc(.*)',
  '/api/scan',
  '/api/actions(.*)',
  '/api/settings(.*)',
  '/api/command-bar',
]);
```

Add `'/api/content-studio(.*)'` after `'/api/command-bar',`:

```typescript
const isProtectedRoute = createRouteMatcher([
  '/dashboard(/.*)?',
  '/review(.*)',
  '/settings(.*)',
  '/api/gsc(.*)',
  '/api/scan',
  '/api/actions(.*)',
  '/api/settings(.*)',
  '/api/command-bar',
  '/api/content-studio(.*)',
]);
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/api/content-studio/drafts/route.ts src/app/api/content-studio/drafts/route.test.ts src/middleware.ts
git commit -m "$(cat <<'EOF'
feat: POST/GET /api/content-studio/drafts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 15: `PATCH /api/content-studio/drafts/[id]` (status transitions + edits)

**Files:**
- Create: `src/app/api/content-studio/drafts/[id]/route.ts`
- Test: `src/app/api/content-studio/drafts/[id]/route.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `auth` from `@clerk/nextjs/server`, `ContentStatus` from `@prisma/client`.
- Produces: `PATCH` handler enforcing the spec's status graph (`draft`/`needs_assets` → `needs_review` → `approved`/`failed` → `ready_to_publish` → `published`; any non-terminal state → `archived`) and allowing a `draftContent` edit independent of status. Consumed by `ContentStudioShell` (Task 18).

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/content-studio/drafts/[id]/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: { contentPiece: { findFirst: vi.fn(), update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/drafts/piece_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('PATCH /api/content-studio/drafts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await PATCH(makeRequest({ status: 'needs_review' }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the content piece is not owned by the caller', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ status: 'needs_review' }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(403);
  });

  it('returns 400 for a disallowed status transition', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });

    const res = await PATCH(makeRequest({ status: 'published' }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(400);
    expect(db.contentPiece.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the body has neither status nor draftContent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });

    const res = await PATCH(makeRequest({}), { params: { id: 'piece_1' } });

    expect(res.status).toBe(400);
  });

  it('applies an allowed status transition and stamps decidedAt', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'needs_review' });

    const res = await PATCH(makeRequest({ status: 'needs_review' }), { params: { id: 'piece_1' } });

    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: expect.objectContaining({ status: 'needs_review', decidedAt: expect.any(Date) }),
    });
    expect(res.status).toBe(200);
  });

  it('applies a draftContent edit without requiring a status change', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1' });

    await PATCH(makeRequest({ draftContent: { body: 'Edited copy.' } }), { params: { id: 'piece_1' } });

    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: { draftContent: { body: 'Edited copy.' } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/content-studio/drafts/[id]/route.test.ts"`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/content-studio/drafts/[id]/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ContentStatus } from '@prisma/client';

const ALLOWED_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['needs_review', 'archived'],
  needs_assets: ['needs_review', 'archived'],
  needs_review: ['approved', 'failed', 'archived'],
  approved: ['ready_to_publish', 'archived'],
  ready_to_publish: ['published', 'archived'],
  published: ['archived'],
  failed: ['archived'],
  archived: [],
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const piece = await db.contentPiece.findFirst({
    where: { id: params.id, clientProfile: { customer: { clerkUserId: userId } } },
  });
  if (!piece) {
    return NextResponse.json({ error: 'Content piece not found' }, { status: 403 });
  }

  const body = await req.json();
  const data: { status?: ContentStatus; draftContent?: unknown; decidedAt?: Date } = {};

  if (typeof body.status === 'string') {
    const nextStatus = body.status as ContentStatus;
    if (!ALLOWED_TRANSITIONS[piece.status].includes(nextStatus)) {
      return NextResponse.json({ error: `Cannot move from ${piece.status} to ${nextStatus}` }, { status: 400 });
    }
    data.status = nextStatus;
    data.decidedAt = new Date();
  }
  if (body.draftContent !== undefined) {
    data.draftContent = body.draftContent;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await db.contentPiece.update({ where: { id: params.id }, data: data as never });
  return NextResponse.json(updated);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/content-studio/drafts/[id]/route.test.ts"`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/content-studio/drafts/[id]/route.ts" "src/app/api/content-studio/drafts/[id]/route.test.ts"
git commit -m "$(cat <<'EOF'
feat: PATCH /api/content-studio/drafts/[id] status transitions and edits

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 16: `GET /api/content-studio/drafts/[id]/export`

**Files:**
- Create: `src/app/api/content-studio/drafts/[id]/export/route.ts`
- Test: `src/app/api/content-studio/drafts/[id]/export/route.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db`, `auth` from `@clerk/nextjs/server`, `formatContentExport` from `@/lib/content-studio/export-formatter` (Task 13).
- Produces: `GET` handler returning `text/plain` export body. Consumed by `ContentStudioShell` (Task 18) as a link target.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/content-studio/drafts/[id]/export/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { formatContentExport } from '@/lib/content-studio/export-formatter';

vi.mock('@/lib/db', () => ({
  db: { contentPiece: { findFirst: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/content-studio/export-formatter', () => ({ formatContentExport: vi.fn() }));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/drafts/piece_1/export') as unknown as NextRequest;
}

describe('GET /api/content-studio/drafts/[id]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest(), { params: { id: 'piece_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the content piece is not owned by the caller', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: { id: 'piece_1' } });

    expect(res.status).toBe(403);
  });

  it('returns the formatted export as plain text', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      platform: 'linkedin',
      draftContent: { body: 'A fine post.', hashtags: ['sale'] },
    });
    (formatContentExport as ReturnType<typeof vi.fn>).mockReturnValue('A fine post.\n\n#sale');

    const res = await GET(makeRequest(), { params: { id: 'piece_1' } });
    const text = await res.text();

    expect(formatContentExport).toHaveBeenCalledWith('linkedin', { body: 'A fine post.', hashtags: ['sale'] });
    expect(text).toBe('A fine post.\n\n#sale');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/content-studio/drafts/[id]/export/route.test.ts"`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/content-studio/drafts/[id]/export/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { formatContentExport } from '@/lib/content-studio/export-formatter';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const piece = await db.contentPiece.findFirst({
    where: { id: params.id, clientProfile: { customer: { clerkUserId: userId } } },
  });
  if (!piece) {
    return NextResponse.json({ error: 'Content piece not found' }, { status: 403 });
  }

  const text = formatContentExport(piece.platform, piece.draftContent);
  return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/content-studio/drafts/[id]/export/route.test.ts"`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/content-studio/drafts/[id]/export/route.ts" "src/app/api/content-studio/drafts/[id]/export/route.test.ts"
git commit -m "$(cat <<'EOF'
feat: GET /api/content-studio/drafts/[id]/export

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 17: `ContentStudioShell` client component

**Files:**
- Create: `src/components/content-studio/content-studio-shell.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button`, `Card`/`CardContent` from `@/components/ui/card`. Calls `POST /api/content-studio/drafts` and `PATCH /api/content-studio/drafts/[id]` (Tasks 14-15) via `fetch`.
- Produces: `ContentStudioShell(props: { clientProfileId: string; initialPieces: ContentPieceView[]; pendingActions: { id: string; pageUrl: string; actionType: string }[]; initialPlatform?: ContentPlatform; initialTopic?: string })`. `ContentPieceView` and `ContentPlatform`/`ContentStatus` string-literal unions are defined locally in this file (not imported from `@prisma/client`, to avoid bundling a Node-only package into client code). Consumed by `/studio/page.tsx` (Task 18).

No test file for this task — the codebase has no component-level test convention (`vitest.config.ts` runs `environment: 'node'`; the existing `CommandBar` client component this shell parallels has no test file either). Correctness is covered by the typecheck/build gate below plus a manual smoke check.

- [ ] **Step 1: Write the component**

```tsx
// src/components/content-studio/content-studio-shell.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type ContentPlatform = 'linkedin' | 'instagram' | 'facebook' | 'x' | 'reddit' | 'tiktok' | 'youtube' | 'ugc_brief';

type ContentStatus =
  | 'draft'
  | 'needs_assets'
  | 'needs_review'
  | 'approved'
  | 'ready_to_publish'
  | 'published'
  | 'failed'
  | 'archived';

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

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Draft',
  needs_assets: 'Needs assets',
  needs_review: 'Needs review',
  approved: 'Approved',
  ready_to_publish: 'Ready to publish',
  published: 'Published',
  failed: 'Failed',
  archived: 'Archived',
};

const NEXT_STATUS: Partial<Record<ContentStatus, ContentStatus[]>> = {
  draft: ['needs_review'],
  needs_assets: ['needs_review'],
  needs_review: ['approved', 'failed'],
  approved: ['ready_to_publish'],
  ready_to_publish: ['published'],
};

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
  const [pieces, setPieces] = useState<ContentPieceView[]>(initialPieces);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content-studio/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientProfileId, platform, topic, sourceActionId: sourceActionId || undefined }),
      });
      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        throw new Error(responseBody.error ?? 'Something went wrong.');
      }
      const piece = (await res.json()) as ContentPieceView;
      setPieces((prev) => [piece, ...prev]);
      setTopic('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(id: string, status: ContentStatus) {
    const res = await fetch(`/api/content-studio/drafts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as ContentPieceView;
    setPieces((prev) => prev.map((p) => (p.id === id ? updated : p)));
  }

  const grouped = (Object.keys(STATUS_LABELS) as ContentStatus[])
    .map((status) => ({ status, items: pieces.filter((p) => p.status === status) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <form onSubmit={handleGenerate} className="flex flex-col gap-3">
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
                value={sourceActionId}
                onChange={(e) => setSourceActionId(e.target.value)}
                className="h-9 rounded-md border border-border bg-transparent px-3 text-sm"
                aria-label="Link a pending finding (optional)"
              >
                <option value="">No linked finding</option>
                {pendingActions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.actionType} — {a.pageUrl}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What's this post about?"
                aria-label="Topic"
                className="h-11 flex-1 rounded-md border border-[var(--dex-app-border-strong)] bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" variant="accent" disabled={loading || !topic.trim()} className="h-11">
                {loading ? 'Drafting…' : 'Draft'}
              </Button>
            </div>
          </form>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">No drafts yet. Pick a platform and a topic above.</p>
      )}

      {grouped.map(({ status, items }) => (
        <div key={status} className="flex flex-col gap-2">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {STATUS_LABELS[status]} ({items.length})
          </h3>
          <div className="flex flex-col gap-2">
            {items.map((piece) => (
              <ContentPieceCard key={piece.id} piece={piece} onStatusChange={handleStatusChange} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

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
          <span className="text-sm font-medium text-foreground">
            {PLATFORM_LABELS[piece.platform]} — {piece.topic}
          </span>
          <div className="flex gap-2">
            {nextOptions.map((status) => (
              <Button key={status} size="sm" variant="outline" onClick={() => onStatusChange(piece.id, status)}>
                {STATUS_LABELS[status]}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => onStatusChange(piece.id, 'archived')}>
              Archive
            </Button>
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

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/content-studio/content-studio-shell.tsx
git commit -m "$(cat <<'EOF'
feat: ContentStudioShell — platform picker, draft generation, status kanban

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 18: `/studio` page

**Files:**
- Create: `src/app/studio/page.tsx`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `ensureCustomer`, `PENDING_WEBSITE_URL` from `@/lib/customer`, `db` from `@/lib/db`, `UtilityBar` from `@/components/app-shell/utility-bar`, `ContentStudioShell` from `@/components/content-studio/content-studio-shell` (Task 17).
- Produces: the `/studio` page, reading `?platform=` and `?topic=` search params (set by the command-bar `request_content` intent in Task 20) to pre-fill the form.

- [ ] **Step 1: Write the page**

```tsx
// src/app/studio/page.tsx
import { auth } from '@clerk/nextjs/server';
import { ensureCustomer, PENDING_WEBSITE_URL } from '@/lib/customer';
import { db } from '@/lib/db';
import { UtilityBar } from '@/components/app-shell/utility-bar';
import { ContentStudioShell, type ContentPieceView } from '@/components/content-studio/content-studio-shell';

const VALID_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x', 'reddit', 'tiktok', 'youtube', 'ugc_brief'];

export default async function StudioPage({
  searchParams,
}: {
  searchParams: { platform?: string; topic?: string };
}) {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  const { website } = await ensureCustomer(userId, PENDING_WEBSITE_URL);
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

  const initialPlatform = VALID_PLATFORMS.includes(searchParams.platform ?? '')
    ? (searchParams.platform as ContentPieceView['platform'])
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
      />
    </div>
  );
}
```

- [ ] **Step 2: Add `/studio` to Clerk's protected page routes**

In `src/middleware.ts`, add `'/studio(.*)'` to the `createRouteMatcher` array, alongside `'/dashboard(/.*)?'`:

```typescript
const isProtectedRoute = createRouteMatcher([
  '/dashboard(/.*)?',
  '/studio(.*)',
  '/review(.*)',
  '/settings(.*)',
  '/api/gsc(.*)',
  '/api/scan',
  '/api/actions(.*)',
  '/api/settings(.*)',
  '/api/command-bar',
  '/api/content-studio(.*)',
]);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Build**

Run: `npx next build`
Expected: PASS, `/studio` listed in the route output.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, sign in, visit `/studio`. Confirm the platform picker, topic field, and Draft button render; confirm `/studio?platform=linkedin&topic=spring+sale` pre-fills the form. This is a UI change — do not skip this manual check even though the automated gate passed.

- [ ] **Step 6: Commit**

```bash
git add src/app/studio/page.tsx src/middleware.ts
git commit -m "$(cat <<'EOF'
feat: /studio route for Content Studio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 19: Command-bar `request_content` intent

**Files:**
- Modify: `src/lib/command-bar/intent-router.ts`
- Modify: `src/lib/command-bar/intent-router.test.ts`

**Interfaces:**
- Produces: adds `{ type: 'request_content'; platform: ContentPlatform | null; topic: string | null }` to the `CommandBarIntent` union. Consumed by the command-bar route in Task 20.

- [ ] **Step 1: Add failing tests to the existing test file**

Add these `it` blocks inside the existing `describe('parseCommandBarIntent', ...)` block in `src/lib/command-bar/intent-router.test.ts` (do not remove any existing test):

```typescript
  it('extracts a request_content intent with platform and topic from "about ..." phrasing', () => {
    expect(parseCommandBarIntent('draft a linkedin post about our spring sale')).toEqual({
      type: 'request_content',
      platform: 'linkedin',
      topic: 'our spring sale',
    });
  });

  it('extracts a request_content intent with no topic when "about" is absent', () => {
    expect(parseCommandBarIntent('write something for instagram')).toEqual({
      type: 'request_content',
      platform: 'instagram',
      topic: null,
    });
  });

  it('recognizes tiktok and ugc_brief platform keywords', () => {
    expect(parseCommandBarIntent('create a tiktok script')).toEqual({
      type: 'request_content',
      platform: 'tiktok',
      topic: null,
    });
    expect(parseCommandBarIntent('write a ugc brief')).toEqual({
      type: 'request_content',
      platform: 'ugc_brief',
      topic: null,
    });
  });

  it('does not misfire request_content for pending-review phrasing containing the word draft', () => {
    expect(parseCommandBarIntent('show me pending drafts')).toEqual({ type: 'list_pending' });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/command-bar/intent-router.test.ts`
Expected: FAIL on the 3 new `request_content` assertions (existing tests still pass).

- [ ] **Step 3: Modify the implementation**

Replace the full contents of `src/lib/command-bar/intent-router.ts`:

```typescript
/**
 * Deterministic intent router for the command bar. Pattern-matching only —
 * no LLM in this path, no dynamic dispatch, no user text ever reaches a
 * shell, SQL string, or arbitrary tool call. The route handler that consumes
 * this switches on `.type` against a fixed, explicit set of allowlisted
 * server actions; a `CommandBarIntent` value is inert data, not a command.
 *
 * Scope: run an audit, list pending drafts, list measured outcomes, request
 * a content draft (Content Studio — navigates only, never generates), or
 * fall back to help. "Explain a specific finding" needs more plumbing
 * (selected-item context) and is intentionally deferred, not silently
 * dropped.
 */

import type { ContentPlatform } from '@prisma/client';

export type CommandBarIntent =
  | { type: 'run_audit'; pastedUrl: string | null }
  | { type: 'list_pending' }
  | { type: 'list_outcomes' }
  | { type: 'request_content'; platform: ContentPlatform | null; topic: string | null }
  | { type: 'help' };

const AUDIT_KEYWORDS = /\b(audit|scan|check|crawl)\b/i;
const PENDING_KEYWORDS = /\b(pending|needs?\s+(review|attention)|drafts?|queue)\b/i;
const OUTCOMES_KEYWORDS = /\b(outcomes?|results?|measured|what happened|performance)\b/i;
// Bare-domain match (example.com/path) or a full http(s) URL — either way we
// only ever use this to compare against the workspace's own connected site,
// never to fetch or execute anything from the string itself.
const URL_PATTERN = /(https?:\/\/\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;

const CONTENT_KEYWORDS = /\b(draft|write|create)\b/i;
const PLATFORM_PATTERNS: [RegExp, ContentPlatform][] = [
  [/\blinkedin\b/i, 'linkedin'],
  [/\binstagram\b/i, 'instagram'],
  [/\bfacebook\b/i, 'facebook'],
  [/\b(x|twitter)\b/i, 'x'],
  [/\breddit\b/i, 'reddit'],
  [/\btiktok\b/i, 'tiktok'],
  [/\byoutube\b/i, 'youtube'],
  [/\b(ugc|creator brief)\b/i, 'ugc_brief'],
];
const TOPIC_PATTERN = /\babout\s+(.+)$/i;

export function parseCommandBarIntent(rawInput: string): CommandBarIntent {
  const text = rawInput.trim();
  if (!text) return { type: 'help' };

  const urlMatch = text.match(URL_PATTERN);
  if (urlMatch) {
    return { type: 'run_audit', pastedUrl: urlMatch[0] };
  }
  if (AUDIT_KEYWORDS.test(text)) return { type: 'run_audit', pastedUrl: null };

  if (CONTENT_KEYWORDS.test(text)) {
    const platformMatch = PLATFORM_PATTERNS.find(([pattern]) => pattern.test(text));
    if (platformMatch) {
      const topicMatch = text.match(TOPIC_PATTERN);
      return { type: 'request_content', platform: platformMatch[1], topic: topicMatch ? topicMatch[1].trim() : null };
    }
  }

  if (PENDING_KEYWORDS.test(text)) return { type: 'list_pending' };
  if (OUTCOMES_KEYWORDS.test(text)) return { type: 'list_outcomes' };
  return { type: 'help' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/command-bar/intent-router.test.ts`
Expected: PASS (all existing + 4 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/command-bar/intent-router.ts src/lib/command-bar/intent-router.test.ts
git commit -m "$(cat <<'EOF'
feat: request_content intent in command-bar router

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 20: Wire `request_content` into the command-bar route

**Files:**
- Modify: `src/app/api/command-bar/route.ts`
- Modify: `src/app/api/command-bar/route.test.ts`

**Interfaces:**
- Consumes: `CommandBarIntent` (Task 19, now including `request_content`).
- Produces: a `request_content` case in `handleIntent` returning a message plus a `{ label: 'Open Content Studio', href: '/studio?...' }` action — pure formatting, no new DB calls, no generation triggered from this path (keeps the command bar's allowlist discipline: it only ever navigates or calls existing authorized functions).

- [ ] **Step 1: Add a failing test to the existing test file**

Add inside the existing `describe('POST /api/command-bar', ...)` block in `src/app/api/command-bar/route.test.ts`:

```typescript
  it('returns a Content Studio link for a request_content intent, with platform and topic in the query string', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(customerWithWebsite());

    const res = await POST(makeRequest('draft a linkedin post about our new feature'));
    const body = await res.json();

    expect(body.actions[0]).toEqual({
      label: 'Open Content Studio',
      href: '/studio?platform=linkedin&topic=our+new+feature',
    });
    expect(body.message).toContain('linkedin');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/command-bar/route.test.ts`
Expected: FAIL — falls through to the `help` case instead of `request_content`.

- [ ] **Step 3: Modify the implementation**

In `src/app/api/command-bar/route.ts`, add a case to the `switch (intent.type)` block in `handleIntent`, immediately before the `case 'help':` line:

```typescript
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

```

Update the doc comment at the top of the file (the "Explicit allowlist" comment) to drop the now-stale claim that content requests are unhandled — it currently only lists `run_audit`/`list_pending`/`list_outcomes`/`help`; add `request_content` to that list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/command-bar/route.test.ts`
Expected: PASS (all existing + 1 new test)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/command-bar/route.ts src/app/api/command-bar/route.test.ts
git commit -m "$(cat <<'EOF'
feat: wire request_content intent to a Content Studio deep link

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```

---

## Task 21: Milestone gate — full regression, build, checkpoint

**Files:** none created or modified beyond the checkpoint doc below.

**Interfaces:** none — this task verifies everything Tasks 1-20 produced works together.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, all prior tests (412 from Milestones B/C) plus every test added in Tasks 2-16, 19-20 (≈70 new tests) passing.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Production build**

Run: `npx next build`
Expected: PASS, `/studio` and all `/api/content-studio/*` routes listed in the build output.

- [ ] **Step 4: Update the durable progress doc**

Edit `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md` (the checkpoint progress doc referenced at session start): move "Milestone D — Content Studio" from remaining to completed, noting the commit range from Task 1 through Task 20.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "$(cat <<'EOF'
docs: mark Milestone D (Content Studio) complete

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ALMJFrUimtLqaCoqMkk6Yc
EOF
)"
```
