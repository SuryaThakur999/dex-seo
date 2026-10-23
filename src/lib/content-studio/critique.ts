import type { ContentPlatform } from '@prisma/client';
import { findBannedPhrases, isContentStructure } from './playbook-shared';

export interface CritiqueInput {
  platform: ContentPlatform;
  objective: string | null;
  hook: string;
  cta: string;
  // Only the five S2 playbook adapters (linkedin/instagram/tiktok/youtube/reddit) assign a
  // structure; Pam's x/facebook/ugc-brief drafts pass undefined and are exempt below.
  structure?: string | null;
  fullText: string;
}

// The five S2 playbook adapters whose validate() requires a structure via
// validatePlaybookFields() -- x/facebook/ugc_brief never call that and have no structure field.
const STRUCTURE_REQUIRED_PLATFORMS: ReadonlySet<ContentPlatform> = new Set([
  'linkedin',
  'instagram',
  'tiktok',
  'youtube',
  'reddit',
]);

export type CritiqueCategory = 'hook' | 'specificity' | 'cta' | 'platform_fit' | 'banned_phrases';

export interface CritiqueFix {
  category: CritiqueCategory;
  issue: string;
  suggestion: string;
}

export interface CritiqueResult {
  score: number;
  fixes: CritiqueFix[];
}

const MIN_HOOK_CHARS = 8;
const MIN_CTA_CHARS = 4;

const DEDUCTIONS: Record<CritiqueCategory, number> = {
  hook: 20,
  specificity: 20,
  cta: 20,
  platform_fit: 15,
  banned_phrases: 10,
};

/**
 * Deterministic, provider-free critique pass over an already-generated draft. Every check here
 * is grounded in something the codebase already enforces or defines (AI_FILLER_PHRASES,
 * ContentStructure) rather than an invented platform rule — adapters already own their own hard
 * character limits (see e.g. x.ts's MAX_BODY_CHARS), so this does not re-litigate length.
 */
export function critiqueDraft(input: CritiqueInput): CritiqueResult {
  const fixes: CritiqueFix[] = [];

  const hook = input.hook.trim();
  if (!hook) {
    fixes.push({
      category: 'hook',
      issue: 'Hook is missing.',
      suggestion: 'Write an opening line that states the specific problem or result on its own, without the rest of the post.',
    });
  } else if (hook.length < MIN_HOOK_CHARS) {
    fixes.push({
      category: 'hook',
      issue: `Hook is only ${hook.length} characters, too short to carry a real claim.`,
      suggestion: 'Expand the hook to name the specific problem, result, or number it leads with.',
    });
  }

  if (!/\d/.test(input.fullText)) {
    fixes.push({
      category: 'specificity',
      issue: 'Draft has no concrete number, timeframe, or figure anywhere in the text.',
      suggestion: 'Add one real, evidence-backed detail (a metric, a timeframe, a count) instead of a general claim.',
    });
  }

  const cta = input.cta.trim();
  if (!cta) {
    fixes.push({
      category: 'cta',
      issue: 'CTA is missing.',
      suggestion: input.objective
        ? `Add a single next action matched to the "${input.objective}" objective.`
        : 'Add a single, specific next action for the reader to take.',
    });
  } else if (cta.length < MIN_CTA_CHARS) {
    fixes.push({
      category: 'cta',
      issue: `CTA is only ${cta.length} characters, too short to be a real instruction.`,
      suggestion: 'State the exact next action (what to click, reply, or do), not a fragment.',
    });
  }

  if (STRUCTURE_REQUIRED_PLATFORMS.has(input.platform)) {
    if (input.structure === undefined || input.structure === null) {
      fixes.push({
        category: 'platform_fit',
        issue: `${input.platform} requires a structure, but none was assigned.`,
        suggestion: 'Pick exactly one of PAS, story, or contrarian and rewrite around it.',
      });
    } else if (!isContentStructure(input.structure)) {
      fixes.push({
        category: 'platform_fit',
        issue: `Structure "${input.structure}" is not one of the platform's supported structures.`,
        suggestion: 'Pick exactly one of PAS, story, or contrarian and rewrite around it.',
      });
    }
  }

  const banned = findBannedPhrases(input.fullText);
  for (const phrase of banned) {
    fixes.push({
      category: 'banned_phrases',
      issue: `Contains the AI-filler phrase "${phrase}".`,
      suggestion: `Remove "${phrase}" and replace it with a specific, concrete statement.`,
    });
  }

  const deducted = fixes.reduce((total, fix) => total + DEDUCTIONS[fix.category], 0);
  const score = Math.max(0, 100 - deducted);

  return { score, fixes };
}
