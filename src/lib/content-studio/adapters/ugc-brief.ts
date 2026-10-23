import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';

export interface UgcBriefDraft {
  brief: string;
  deliverables: string[];
  doNotSay: string[];
}

export const ugcBriefAdapter: PlatformAdapter<UgcBriefDraft> = {
  platform: 'ugc_brief',
  label: 'UGC Brief',

  buildInstructions(): string {
    return [
      'You write a brief handed to a content creator — this is not a post, it is instructions for a human.',
      GROUNDING_RULES,
      '',
      'Output as JSON only, no markdown fences: {"brief": "...", "deliverables": ["...", "..."], "doNotSay": ["...", "..."]}',
      'brief explains the concept and goal in plain language. deliverables lists exactly what the creator must produce (e.g. "1x 30-second video"). doNotSay must copy the Restricted wording list given in the grounding data verbatim, one entry per array item — do not paraphrase or omit any of them.',
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
