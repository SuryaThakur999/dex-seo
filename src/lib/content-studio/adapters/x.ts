import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';

export interface XDraft {
  body: string;
  hashtags: string[];
  posts?: string[];
}

const MAX_BODY_CHARS = 280;

export const xAdapter: PlatformAdapter<XDraft> = {
  platform: 'x',
  label: 'X',

  buildInstructions(): string {
    return [
      'You write an X thread. Open with a specific hook, develop one argument across the posts, and close with an objective-appropriate next step. No hashtag stuffing.',
      GROUNDING_RULES,
      '',
      'Output as JSON only, no markdown fences: {"posts": ["Opening post", "Supporting post", "Closing post"], "hashtags": []}',
      `Each post has a HARD CAP of ${MAX_BODY_CHARS} characters including spaces. Write at least two posts. Use 0-2 hashtags, no # prefix in the array values; they appear on the final post and count toward its limit.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): XDraft {
    try {
      const parsed = JSON.parse(raw);
      const posts = parsed.posts === undefined ? undefined : Array.isArray(parsed.posts)
        ? parsed.posts.map((post: unknown) => typeof post === 'string' ? post : '')
        : [];
      return {
        body: posts === undefined ? (typeof parsed.body === 'string' ? parsed.body : raw) : (posts[0] ?? ''),
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
        ...(posts === undefined ? {} : { posts }),
      };
    } catch {
      return { body: raw, hashtags: [] };
    }
  },

  validate(draft: XDraft) {
    const issues: string[] = [];
    const posts = draft.posts ?? [draft.body];
    if (draft.posts && draft.posts.length < 2) issues.push('A thread needs at least two posts.');
    if (posts.some((post) => !post.trim())) issues.push('Body is empty.');
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    if (posts.some((post, index) => (post.length + (index === posts.length - 1 && tags ? tags.length + 2 : 0)) > MAX_BODY_CHARS)) {
      issues.push(`Body exceeds the ${MAX_BODY_CHARS} character hard cap.`);
    }
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: XDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    const text = (draft.posts ?? [draft.body]).join('\n\n---\n\n');
    return tags ? `${text}\n\n${tags}` : text;
  },
};
