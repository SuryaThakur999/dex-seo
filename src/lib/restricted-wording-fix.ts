import { getOpenAIClient, GENERATION_MODEL } from '@/lib/openai-client';
import { buildTrustedSystemPrompt, serializeUntrustedData, validatePlainTextOutput } from '@/lib/ai/untrusted-data';

// Phase 1F (docs/superpowers/specs/2026-09-25-phase1f-finding-to-action-coverage-design.md):
// restricted_wording_found is "automatically draftable" -- a rewrite removing the flagged
// phrase(s), grounded in the excerpt's own real content, same shape as creation-engine.ts's
// meta_description path. Unlike the deterministic-remediation rules (canonical_fix,
// structured_data_fix, entity_markup_fix), this genuinely needs judgment (a mechanical phrase
// deletion would leave a broken sentence), so it's a real LLM call -- routed through the
// untrusted-data boundary from the start (the excerpt is real page copy, i.e. untrusted), then
// reviewed by the existing runProofLayer (its own no-restricted-wording check is exactly the
// safety net that closes this loop).

export interface RestrictedWordingMatch {
  phrase: string;
  excerpt: string;
}

export interface RestrictedWordingDraftResult {
  draftContent: string;
  tokenCost: number;
}

type OpenAICaller = (systemPrompt: string, userPrompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = GENERATION_MODEL;
export const RESTRICTED_WORDING_FIX_RULE_IDS = ['restricted_wording_found'] as const;
export const RESTRICTED_WORDING_FIX_ACTION_TYPE = 'restricted_wording_fix';

const SYSTEM_PROMPT = buildTrustedSystemPrompt([
  "You rewrite short excerpts from a customer's website to remove specific restricted wording, while preserving each excerpt's real meaning.",
  'Rules:',
  '- Base every rewrite ONLY on facts already present in that excerpt. Never invent new facts, numbers, or claims.',
  '- Remove or replace every restricted phrase given for that excerpt. Do not use it in any form, including partial matches.',
  '- Keep each rewrite close in length and tone to its original excerpt.',
  '- Output ONLY the rewritten excerpts, one per line, in the same order given. No numbering, no labels, no preamble, no explanation.',
]);

function buildPrompt(matches: RestrictedWordingMatch[]): string {
  return serializeUntrustedData(
    'rewrite_excerpts_removing_restricted_wording',
    matches.map((m, i) => ({
      label: `excerpt_${i + 1}`,
      value: `Restricted phrase to remove: "${m.phrase}". Excerpt: "${m.excerpt}"`,
    }))
  );
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

// One rewritten line per input match, in order -- callers that need a diff against the
// original just join matches[].excerpt with '\n', the same separator used here.
export async function draftRestrictedWordingFix(
  matches: RestrictedWordingMatch[],
  callOpenAI: OpenAICaller = defaultCaller
): Promise<RestrictedWordingDraftResult> {
  const userPrompt = buildPrompt(matches);
  const { content, totalTokens } = await callOpenAI(SYSTEM_PROMPT, userPrompt);
  // The whole multi-line blob is validated as one bounded plain-text value, not parsed per
  // line -- validatePlainTextOutput only needs to catch "empty" and "wildly oversized," both of
  // which are whole-response properties. runProofLayer's own no-restricted-wording check is
  // still what verifies each rewritten line actually removed its flagged phrase; this is a
  // cheaper first bound before that real check runs. 400 chars/excerpt is generous headroom
  // over the "close in length to its original excerpt" instruction above.
  const validated = validatePlainTextOutput(content, Math.max(400, matches.length * 400));
  if (!validated.ok) {
    throw new Error(`Restricted-wording rewrite failed validation: ${validated.error}`);
  }
  return { draftContent: validated.data, tokenCost: totalTokens };
}
