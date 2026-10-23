import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';

export interface FacebookDraft {
  body: string;
  hashtags: string[];
}

const MAX_BODY_CHARS = 63206;

export const facebookAdapter: PlatformAdapter<FacebookDraft> = {
  platform: 'facebook',
  label: 'Facebook',

  buildInstructions(): string {
    return [
      'Write a casual, conversational Facebook post — friendlier in tone than LinkedIn.',
      GROUNDING_RULES,
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
