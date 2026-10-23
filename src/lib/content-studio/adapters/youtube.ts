import type { PlatformAdapter } from '../adapter-types';
import { GROUNDING_RULES } from '../adapter-types';
import {
  STRUCTURE_PLAYBOOK,
  validatePlaybookFields,
  type ContentStructure,
} from '../playbook-shared';

export interface YouTubeDraft {
  hook: string;
  title: string;
  thumbnailText: string;
  description: string;
  tags: string[];
  targetQueries: string[];
  script: string;
  structure: ContentStructure | '';
  cta: string;
}

const MAX_TITLE_CHARS = 100;

// Hook formulas and the title/thumbnail pairing + SEO fields below are folded in from the
// youtube-agent-skill content spec (github.com/Jakeschincariol/youtube-agent-skill, MIT) as
// config/prompt material only, no API clients, no publishing, no chapters (DEX has no video
// duration/timestamp data to validate chapter rules against) and no retention/SRT/comment
// analysis (DEX doesn't ingest those inputs). Flag to god before building any of those if DEX
// turns out to already have that data flowing in.
const HOOK_FORMULAS = [
  '"Here’s what nobody tells you about [topic]."',
  '"I tested [claim] for [timeframe], here’s what happened."',
  '"[Number] mistakes that are costing you [specific loss]."',
  '"The real reason [common outcome] keeps happening."',
].join(' ');

export const youtubeAdapter: PlatformAdapter<YouTubeDraft> = {
  platform: 'youtube',
  label: 'YouTube',

  buildInstructions(): string {
    return [
      'You write a long-form YouTube video: a title, a thumbnail text, an SEO-minded description, tags, target search queries, and a spoken script.',
      'hook is the exact line spoken in the first 15 seconds: the reason someone does not click away.',
      `Hook formulas to draw from: ${HOOK_FORMULAS}`,
      STRUCTURE_PLAYBOOK,
      'cta is the spoken call to action (subscribe, watch next, visit link in description), matched to the objective given in the data.',
      'title and thumbnailText are judged as a pair, not separately: thumbnailText must add information the title does not repeat, and neither may be vague ("you won’t believe", "this one trick").',
      'tags are a minor, low-effect ranking signal, not a lever: 5-8 short tags, no hashtags. targetQueries are exactly 3 real search queries this video should rank for.',
      'Judge your own wording, not promised outcomes. If a specific number is missing from the data, ask for it rather than inventing one.',
      GROUNDING_RULES,
      '',
      'Output as JSON only, no markdown fences: {"hook": "...", "title": "...", "thumbnailText": "...", "description": "...", "tags": ["...", "...", "...", "...", "..."], "targetQueries": ["...", "...", "..."], "script": "...", "structure": "PAS|story|contrarian", "cta": "..."}',
      `title stays under ${MAX_TITLE_CHARS} characters. description is what viewers read below the video, separate from script, which is what gets spoken on screen and must include the hook as its opening line and the cta near its close.`,
    ].join('\n');
  },

  parseModelOutput(raw: string): YouTubeDraft {
    try {
      const parsed = JSON.parse(raw);
      return {
        hook: typeof parsed.hook === 'string' ? parsed.hook : '',
        title: typeof parsed.title === 'string' ? parsed.title : '',
        thumbnailText: typeof parsed.thumbnailText === 'string' ? parsed.thumbnailText : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === 'string') : [],
        targetQueries: Array.isArray(parsed.targetQueries)
          ? parsed.targetQueries.filter((q: unknown) => typeof q === 'string')
          : [],
        script: typeof parsed.script === 'string' ? parsed.script : raw,
        structure: typeof parsed.structure === 'string' ? parsed.structure : '',
        cta: typeof parsed.cta === 'string' ? parsed.cta : '',
      };
    } catch {
      return {
        hook: '',
        title: '',
        thumbnailText: '',
        description: '',
        tags: [],
        targetQueries: [],
        script: raw,
        structure: '',
        cta: '',
      };
    }
  },

  validate(draft: YouTubeDraft) {
    const issues: string[] = [];
    if (!draft.title.trim()) issues.push('A title is required.');
    if (draft.title.length > MAX_TITLE_CHARS) issues.push(`Title exceeds ${MAX_TITLE_CHARS} characters.`);
    if (!draft.script.trim()) issues.push('Script is empty.');
    if (!draft.thumbnailText.trim()) issues.push('Thumbnail text is required.');
    if (/\b(?:you won['’]t believe|this one trick)\b/i.test(`${draft.title}\n${draft.thumbnailText}`)) {
      issues.push('Title and thumbnail text must avoid vague clickbait phrases.');
    }
    // Title/thumbnail pairing lint (yt-package): judged as a pair, so an exact duplicate of the
    // title adds no new information and fails the pairing check.
    if (
      draft.thumbnailText.trim() &&
      draft.thumbnailText.trim().toLowerCase() === draft.title.trim().toLowerCase()
    ) {
      issues.push('Thumbnail text duplicates the title. The pair must add information, not repeat it.');
    }
    if (draft.targetQueries.length !== 3) {
      issues.push('Exactly 3 target search queries are required.');
    }
    if (draft.tags.length < 5 || draft.tags.length > 8 || draft.tags.some((tag) => !tag.trim())) {
      issues.push('Between 5 and 8 non-empty tags are required.');
    }
    if (draft.targetQueries.some((query) => {
      const text = query.trim();
      return !text || /^(?:\.{2,}|…|\[[^\]]*\]|tbd|todo|placeholder|(?:target\s+|search\s+)?query(?:\s*\d+)?)$/i.test(text);
    })) {
      issues.push('Target search queries must be non-empty and must not be placeholders.');
    }
    issues.push(
      ...validatePlaybookFields({
        hook: draft.hook,
        structure: draft.structure,
        cta: draft.cta,
        fullText: `${draft.script}\n${draft.description}\n${draft.cta}`,
      })
    );
    return { valid: issues.length === 0, issues };
  },

  formatExport(draft: YouTubeDraft): string {
    const parts = [`Title: ${draft.title}`];
    if (draft.thumbnailText) parts.push(`Thumbnail text: ${draft.thumbnailText}`);
    parts.push(`Description:\n${draft.description}`);
    if (draft.tags.length) parts.push(`Tags: ${draft.tags.join(', ')}`);
    if (draft.targetQueries.length) parts.push(`Target search queries: ${draft.targetQueries.join(', ')}`);
    parts.push(`Script:\n${draft.script}`);
    return parts.join('\n\n');
  },
};
