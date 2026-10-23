import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';
import {
  STRUCTURE_PLAYBOOK,
  validatePlaybookFields,
  emDashesPerHundredWords,
  type ContentStructure,
} from '../playbook-shared';

export interface LinkedInDraft {
  hook: string;
  body: string;
  structure: ContentStructure | '';
  cta: string;
  hashtags: string[];
}

const MAX_BODY_CHARS = 3000;
const MAX_EM_DASHES_PER_HUNDRED_WORDS = 1;

// Hook formulas and founder-angle templates below are folded in from the linkedin-skills
// content spec (github.com/sergebulaev/linkedin-skills, MIT) as prompt material only, not its
// Apify/Publora/Pixfaro API clients, which DEX's own crawl/publish pipeline makes out of scope.
const HOOK_FORMULAS = [
  '"I was wrong about [belief]."',
  '"[Impressive result], and it only took [surprisingly short time]."',
  '"[Number] years ago I [past state]. Today, [current state]."',
  '"Unpopular opinion: [bold, defensible statement]."',
  '"Stop [common mistake]. Do this instead:"',
].join(' ');

const FOUNDER_ANGLES = [
  'For high-stakes readers (investors, candidates, prospective hires) over raw reach:',
  'the lesson from a hard decision, the metric that surprised you, the hire you almost missed,',
  'the trade-off you made and why, the thing competitors get wrong.',
].join(' ');

export const linkedinAdapter: PlatformAdapter<LinkedInDraft> = {
  platform: 'linkedin',
  label: 'LinkedIn',

  buildInstructions(): string {
    return [
      'Write a professional, direct-tone LinkedIn post for a business audience, no hype, no emoji spam.',
      'hook is the first line only, written to stop the scroll on its own: it must work with the post collapsed.',
      `Hook formulas to draw from: ${HOOK_FORMULAS}`,
      `Founder angle library: ${FOUNDER_ANGLES}`,
      STRUCTURE_PLAYBOOK,
      'cta is the single next action you want the reader to take, matched to the objective given in the data (for example: comment with their experience for awareness, book a call for conversion).',
      'Writing rules: prefer specific numbers over adjectives. Capitalize proper names correctly. Use at most one em dash per 100 words. Target 900-1300 characters for the body.',
      GROUNDING_RULES,
      '',
      'Output as JSON only, no markdown fences: {"hook": "...", "body": "...", "structure": "PAS|story|contrarian", "cta": "...", "hashtags": ["...", "..."]}',
      `body is the full post including the hook as its opening line. Body must stay under ${MAX_BODY_CHARS} characters. 3-5 hashtags, no # prefix in the array values.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): LinkedInDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        hook: typeof parsed.hook === 'string' ? parsed.hook : '',
        body: typeof parsed.body === 'string' ? parsed.body : raw,
        structure: typeof parsed.structure === 'string' ? parsed.structure : '',
        cta: typeof parsed.cta === 'string' ? parsed.cta : '',
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
      };
    } catch {
      return { hook: '', body: raw, structure: '', cta: '', hashtags: [] };
    }
  },

  validate(draft: LinkedInDraft) {
    const issues: string[] = [];
    if (!draft.body.trim()) issues.push('Body is empty.');
    if (draft.body.length > MAX_BODY_CHARS) issues.push(`Body exceeds ${MAX_BODY_CHARS} characters.`);
    // Pre-publish checklist (linkedin-skills spec): an em dash is a reliable AI-writing tell
    // past a low density, so cap at 1 per 100 words.
    if (emDashesPerHundredWords(draft.body) > MAX_EM_DASHES_PER_HUNDRED_WORDS) {
      issues.push('Too many em dashes, reads as AI-written. Cap at 1 per 100 words.');
    }
    issues.push(
      ...validatePlaybookFields({
        hook: draft.hook,
        structure: draft.structure,
        cta: draft.cta,
        fullText: `${draft.body}\n${draft.cta}`,
      })
    );
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: LinkedInDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    return tags ? `${draft.body}\n\n${tags}` : draft.body;
  },
};
