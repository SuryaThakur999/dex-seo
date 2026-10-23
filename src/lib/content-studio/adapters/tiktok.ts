import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';
import {
  STRUCTURE_PLAYBOOK,
  validatePlaybookFields,
  type ContentStructure,
} from '../playbook-shared';

export interface TikTokDraft {
  hook: string;
  script: string;
  structure: ContentStructure | '';
  cta: string;
  captionText: string;
  hashtags: string[];
}

export const tiktokAdapter: PlatformAdapter<TikTokDraft> = {
  platform: 'tiktok',
  label: 'TikTok',

  buildInstructions(): string {
    return [
      'You write a short-form TikTok video script. Fast-paced, hook-first, spoken language not written prose.',
      STRUCTURE_PLAYBOOK,
      'cta is the spoken or on-screen call to action at the end (follow, comment, visit link in bio), matched to the objective given in the data.',
      GROUNDING_RULES,
      '',
      'Output as JSON only, no markdown fences: {"hook": "...", "script": "...", "structure": "PAS|story|contrarian", "cta": "...", "captionText": "...", "hashtags": ["...", "..."]}',
      'hook is the exact line spoken in the first 2 seconds: the reason someone keeps watching. script is the full spoken script, including the hook as its opening line and the cta as its closing line. 3-5 hashtags.',
    ].join('\n');
  },

  parseModelOutput(raw: string): TikTokDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        hook: typeof parsed.hook === 'string' ? parsed.hook : '',
        script: typeof parsed.script === 'string' ? parsed.script : raw,
        structure: typeof parsed.structure === 'string' ? parsed.structure : '',
        cta: typeof parsed.cta === 'string' ? parsed.cta : '',
        captionText: typeof parsed.captionText === 'string' ? parsed.captionText : '',
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
      };
    } catch {
      return { hook: '', script: raw, structure: '', cta: '', captionText: '', hashtags: [] };
    }
  },

  validate(draft: TikTokDraft) {
    const issues: string[] = [];
    if (!draft.hook.trim()) issues.push('Missing the hook (first 2 seconds line).');
    if (!draft.script.trim()) issues.push('Script is empty.');
    issues.push(
      ...validatePlaybookFields({
        hook: draft.hook,
        structure: draft.structure,
        cta: draft.cta,
        fullText: `${draft.script}\n${draft.cta}`,
      })
    );
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: TikTokDraft): string {
    const tags = draft.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    const caption = tags ? `${draft.captionText} ${tags}`.trim() : draft.captionText;
    return `Hook (first 2 seconds): ${draft.hook}\n\nScript:\n${draft.script}\n\nCaption: ${caption}`;
  },
};
