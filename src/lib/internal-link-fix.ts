import { getOpenAIClient, GENERATION_MODEL } from '@/lib/openai-client';
import { buildTrustedSystemPrompt, serializeUntrustedData, validatePlainTextOutput } from '@/lib/ai/untrusted-data';

// Phase 1F (docs/superpowers/specs/2026-09-25-phase1f-finding-to-action-coverage-design.md):
// zero_internal_links is "automatically draftable" -- candidate internal links grounded entirely
// in the site's own crawled page inventory (title+url pairs from the same scan), same "real
// crawled facts in, ProofLayer-reviewed, human-approved" shape meta_description already has. No
// new facts are invented: every candidate source page is a real page this exact scan crawled.
//
// Unlike every other Phase 1F actionType, the fix here doesn't edit the flagged page itself --
// it recommends adding a link TO it FROM other real pages on the site. Action.pageUrl stays the
// flagged (target) page, matching the Finding it came from; draftContent names the source pages
// to edit.

export interface CandidatePage {
  url: string;
  title: string | null;
}

export interface InternalLinkDraftResult {
  draftContent: string;
  tokenCost: number;
}

type OpenAICaller = (systemPrompt: string, userPrompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = GENERATION_MODEL;
export const INTERNAL_LINK_FIX_RULE_IDS = ['zero_internal_links'] as const;
export const INTERNAL_LINK_FIX_ACTION_TYPE = 'internal_link_fix';

// Bounds prompt size on a large site -- a candidate list this long already gives the model
// plenty of real topical variety to choose from without ballooning token cost.
const MAX_CANDIDATES = 20;
const MAX_SUGGESTIONS = 3;

const SYSTEM_PROMPT = buildTrustedSystemPrompt([
  "You suggest internal links for a customer's website: which existing pages should link to a page that currently has none pointing at it.",
  'Rules:',
  `- Choose at most ${MAX_SUGGESTIONS} candidate pages that are genuinely topically relevant to the target page. If none are relevant, say so plainly instead of forcing a match.`,
  '- Base relevance ONLY on the real page titles and URLs given below. Never invent a page, a title, or a reason that is not supported by them.',
  '- For each chosen page, write one line in the exact form: SOURCE_URL | anchor text',
  '- Anchor text must be a short, natural phrase a person would actually click, not the raw title or URL restated.',
  '- Output ONLY those lines (or the one plain sentence saying nothing is relevant). No numbering, no preamble, no explanation.',
]);

function buildPrompt(targetPage: CandidatePage, candidates: CandidatePage[]): string {
  return serializeUntrustedData('suggest_internal_links_to_target_page', [
    { label: 'target_page_url', value: targetPage.url },
    { label: 'target_page_title', value: targetPage.title ?? '(no title found)' },
    ...candidates.slice(0, MAX_CANDIDATES).map((c, i) => ({
      label: `candidate_${i + 1}`,
      value: `${c.url} — ${c.title ?? '(no title found)'}`,
    })),
  ]);
}

async function defaultCaller(systemPrompt: string, userPrompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

// At most MAX_SUGGESTIONS short "URL | anchor text" lines, or one plain sentence saying
// nothing is relevant -- 300 chars/suggestion is generous headroom for either shape.
const MAX_DRAFT_LENGTH = MAX_SUGGESTIONS * 300;

export interface InternalLinkSuggestion {
  url: string;
  anchorText: string;
}

// Dashboard audit: the review screen was showing this stored "URL | anchor text" format as raw
// text. Parses it back into real suggestions for the review UI to render as a link list; a line
// with no "|" (including the model's own "nothing is relevant" plain sentence) or a line missing
// either half is dropped, not fabricated into a broken entry.
export function parseInternalLinkSuggestions(draftContent: string): InternalLinkSuggestion[] {
  return draftContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const separatorIndex = line.indexOf('|');
      if (separatorIndex === -1) return [];
      const url = line.slice(0, separatorIndex).trim();
      const anchorText = line.slice(separatorIndex + 1).trim();
      return url && anchorText ? [{ url, anchorText }] : [];
    });
}

export async function draftInternalLinkFix(
  targetPage: CandidatePage,
  candidates: CandidatePage[],
  callOpenAI: OpenAICaller = defaultCaller
): Promise<InternalLinkDraftResult> {
  const userPrompt = buildPrompt(targetPage, candidates);
  const { content, totalTokens } = await callOpenAI(SYSTEM_PROMPT, userPrompt);
  const validated = validatePlainTextOutput(content, MAX_DRAFT_LENGTH);
  if (!validated.ok) {
    throw new Error(`Internal-link suggestion for ${targetPage.url} failed validation: ${validated.error}`);
  }
  return { draftContent: validated.data, tokenCost: totalTokens };
}
