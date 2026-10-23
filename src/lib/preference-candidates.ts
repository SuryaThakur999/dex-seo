import { getOpenAIClient } from '@/lib/openai-client';
import { buildTrustedSystemPrompt, serializeUntrustedData, parseValidatedOutput } from '@/lib/ai/untrusted-data';
import { runModelOperation } from '@/lib/ai/model-operation';
import type { EligibleEdit } from './feedback-analysis';

export const MIN_SUPPORTING_EDITS = 2;
export const CANDIDATE_MODEL = 'openai/gpt-oss-120b';
export const CANDIDATE_PROMPT_VERSION = 'v1';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mirrors src/lib/audit-agents/brand-specialist.ts's checkRestrictedWording matching exactly --
// case-insensitive, Unicode-letter/number word-boundary-aware, so "lead" never matches inside
// "leadership" and "industry-leading" matches regardless of surrounding punctuation/case.
export function phraseAppearsIn(phrase: string, text: string): boolean {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(text);
}

export interface CandidateVerificationResult {
  valid: boolean;
  supportingEditIds: string[];
  reason?: string;
}

// The LLM proposes; this function decides. All 6 conditions from the design doc's
// "Deterministic verification gate" section, in order, short-circuiting on the first failure.
export function verifyCandidatePhrase(
  phrase: string,
  eligibleEdits: EligibleEdit[],
  existingPhrases: string[],
  restrictedWording: string[]
): CandidateVerificationResult {
  const trimmed = phrase.trim();
  if (!trimmed) return { valid: false, supportingEditIds: [], reason: 'Empty phrase.' };

  // Conditions 5-6: not already restricted, not already represented by an existing candidate.
  const alreadyRestricted = restrictedWording.some((w) => w.trim().toLowerCase() === trimmed.toLowerCase());
  if (alreadyRestricted) return { valid: false, supportingEditIds: [], reason: 'Phrase is already in restrictedWording.' };

  const alreadyProposed = existingPhrases.some((p) => p.trim().toLowerCase() === trimmed.toLowerCase());
  if (alreadyProposed) return { valid: false, supportingEditIds: [], reason: 'Phrase already represented by an existing candidate.' };

  // Conditions 1-2: present in before, absent from after, per edit.
  const supportingEditIds = eligibleEdits
    .filter((e) => phraseAppearsIn(trimmed, e.before) && !phraseAppearsIn(trimmed, e.after))
    .map((e) => e.auditLogEntryId);

  // Condition 3: repeated support, not a single edit.
  if (supportingEditIds.length < MIN_SUPPORTING_EDITS) {
    return { valid: false, supportingEditIds, reason: `Only ${supportingEditIds.length} supporting edit(s), needs at least ${MIN_SUPPORTING_EDITS}.` };
  }

  return { valid: true, supportingEditIds };
}

export interface CandidateProposal {
  phrase: string;
  rationale: string;
}

// Trusted, fixed application code. The model only ever PROPOSES a phrase here — it can never
// approve, promote, or activate one; verifyCandidatePhrase's deterministic 6-condition gate
// (above) is the only thing that decides whether a proposal becomes a real candidate.
const CANDIDATE_SYSTEM_PROMPT = buildTrustedSystemPrompt([
  'You look for a single repeated phrase a website owner keeps removing or replacing across their edits.',
  'Rules:',
  '- Base your answer ONLY on the edits given to you. Never invent a phrase not literally present in the "Before" text of at least two of them.',
  '- If no single phrase is clearly repeated across multiple edits, respond with exactly: none',
  '- Otherwise respond with ONLY a JSON object: {"phrase": "<the exact repeated phrase>", "rationale": "<one short sentence>"}',
  '- No markdown, no code fences, no extra text before or after the JSON.',
  '- You are proposing a candidate only. You cannot approve, promote, or activate it — that is decided by separate deterministic code, never by you.',
]);

export function buildCandidateExtractionPrompt(edits: EligibleEdit[]): string {
  return serializeUntrustedData(
    'propose_repeated_edit_phrase',
    edits.map((e) => ({
      label: `edit_${e.auditLogEntryId}`,
      value: `Action type: ${e.actionType} | Decision: edited | Timestamp: ${e.timestamp.toISOString()}\nBefore: ${e.before}\nAfter: ${e.after}`,
    }))
  );
}

type CandidateCaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

async function defaultCandidateCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: CANDIDATE_MODEL,
    messages: [
      { role: 'system', content: CANDIDATE_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

function isCandidateProposal(value: unknown): value is CandidateProposal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).phrase === 'string' &&
    typeof (value as Record<string, unknown>).rationale === 'string' &&
    Boolean((value as { phrase: string }).phrase.trim())
  );
}

export async function proposeCandidate(edits: EligibleEdit[], callOpenAI: CandidateCaller = defaultCandidateCaller): Promise<CandidateProposal | null> {
  // Phase 1E: bounded retry+backoff on a transient provider failure now happens here, above the
  // SDK's own maxRetries:2, before falling through to the existing "no candidate this cycle"
  // outcome -- a malformed/invalid proposal (parseValidatedOutput failing) is a deterministic
  // outcome retrying can't fix, so it's still handled below, not inside the operation.
  const result = await runModelOperation({
    operationName: 'preference_candidate_proposal',
    promptVersion: CANDIDATE_PROMPT_VERSION,
    boundaryVersion: 'v1',
    execute: () => callOpenAI(buildCandidateExtractionPrompt(edits)),
  });
  if (result.outcome !== 'succeeded' || !result.data) return null;

  const { content } = result.data;
  if (!content || content.trim().toLowerCase() === 'none') return null;
  const validated = parseValidatedOutput(content, isCandidateProposal);
  if (!validated.ok) return null;
  return { phrase: validated.data.phrase.trim(), rationale: validated.data.rationale.trim() };
}
