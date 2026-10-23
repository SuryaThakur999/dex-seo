import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';
import {
  STRUCTURE_PLAYBOOK,
  validatePlaybookFields,
  type ContentStructure,
} from '../playbook-shared';

export interface RedditDraft {
  hook: string;
  title: string;
  body: string;
  structure: ContentStructure | '';
  cta: string;
  suggestedSubreddits: string[];
}

const MAX_TITLE_CHARS = 300;

export const redditAdapter: PlatformAdapter<RedditDraft> = {
  platform: 'reddit',
  label: 'Reddit',

  buildInstructions(): string {
    return [
      'You write a Reddit post. Honest, conversational, discussion-first, no marketing-speak: Reddit users penalize obvious ads.',
      'hook is the first line of the body only: the line that earns a click past the title.',
      STRUCTURE_PLAYBOOK,
      'cta is a genuine discussion prompt or question matched to the objective given in the data, never a sales pitch (e.g. "has anyone else run into this?").',
      GROUNDING_RULES,
      '',
      'Output as JSON only, no markdown fences: {"hook": "...", "title": "...", "body": "...", "structure": "PAS|story|contrarian", "cta": "...", "suggestedSubreddits": ["...", "..."]}',
      `body is the full post including the hook as its opening line and the cta as its closing line. Title must stay under ${MAX_TITLE_CHARS} characters. suggestedSubreddits are names only, no "r/" prefix.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): RedditDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        hook: typeof parsed.hook === 'string' ? parsed.hook : '',
        title: typeof parsed.title === 'string' ? parsed.title : '',
        body: typeof parsed.body === 'string' ? parsed.body : raw,
        structure: typeof parsed.structure === 'string' ? parsed.structure : '',
        cta: typeof parsed.cta === 'string' ? parsed.cta : '',
        suggestedSubreddits: Array.isArray(parsed.suggestedSubreddits)
          ? parsed.suggestedSubreddits.filter((s: unknown) => typeof s === 'string')
          : [],
      };
    } catch {
      return { hook: '', title: '', body: raw, structure: '', cta: '', suggestedSubreddits: [] };
    }
  },

  validate(draft: RedditDraft) {
    const issues: string[] = [];
    if (!draft.title.trim()) issues.push('A title is required.');
    if (draft.title.length > MAX_TITLE_CHARS) issues.push(`Title exceeds ${MAX_TITLE_CHARS} characters.`);
    if (!draft.body.trim()) issues.push('Body is empty.');
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

  formatExport(draft: RedditDraft): string {
    const parts = [`Title: ${draft.title}`, draft.body];
    if (draft.suggestedSubreddits.length) {
      parts.push(`Suggested subreddits: ${draft.suggestedSubreddits.map((s) => `r/${s.replace(/^r\//, '')}`).join(', ')}`);
    }
    return parts.join('\n\n');
  },
};
