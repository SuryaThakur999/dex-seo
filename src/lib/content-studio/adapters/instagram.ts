import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';
import {
  STRUCTURE_PLAYBOOK,
  validatePlaybookFields,
  type ContentStructure,
} from '../playbook-shared';

export interface InstagramDraft {
  hook: string;
  caption: string;
  structure: ContentStructure | '';
  cta: string;
  hashtags: string[];
  altText: string;
}

export const instagramAdapter: PlatformAdapter<InstagramDraft> = {
  platform: 'instagram',
  label: 'Instagram',

  buildInstructions(): string {
    return [
      'You write an Instagram caption and a visual brief. Visual, upbeat, short paragraphs or line breaks.',
      'hook is the first line of the caption only: the part visible before "more" truncates it.',
      STRUCTURE_PLAYBOOK,
      'cta is the single action you want the viewer to take, matched to the objective given in the data (comment, save, visit link in bio, etc).',
      GROUNDING_RULES,
      '',
      'Output as JSON only, no markdown fences: {"hook": "...", "caption": "...", "structure": "PAS|story|contrarian", "cta": "...", "hashtags": ["...", "..."], "altText": "..."}',
      'caption is the full caption including the hook as its opening line. altText is a plain, literal description of the image this caption goes with, required for screen-reader accessibility. 5-8 hashtags.',
    ].join('\n');
  },

  parseModelOutput(raw: string): InstagramDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        hook: typeof parsed.hook === 'string' ? parsed.hook : '',
        caption: typeof parsed.caption === 'string' ? parsed.caption : raw,
        structure: typeof parsed.structure === 'string' ? parsed.structure : '',
        cta: typeof parsed.cta === 'string' ? parsed.cta : '',
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
        altText: typeof parsed.altText === 'string' ? parsed.altText : '',
      };
    } catch {
      return { hook: '', caption: raw, structure: '', cta: '', hashtags: [], altText: '' };
    }
  },

  validate(draft: InstagramDraft) {
    const issues: string[] = [];
    if (!draft.caption.trim()) issues.push('Caption is empty.');
    if (!draft.altText.trim()) issues.push('Missing alt text for accessibility.');
    issues.push(
      ...validatePlaybookFields({
        hook: draft.hook,
        structure: draft.structure,
        cta: draft.cta,
        fullText: `${draft.caption}\n${draft.cta}`,
      })
    );
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
