import { GROUNDING_RULES } from './adapter-types';
import type { CritiqueResult } from './critique';

export interface ReviseDraftInput {
  fullText: string;
  critique: CritiqueResult;
}

/**
 * Builds the revision-pass prompt text only -- never calls a provider itself. Keeps
 * GROUNDING_RULES verbatim so the revision pass stays under the same no-hallucination
 * discipline as the original generation (plan: "Keep GROUNDING_RULES and ProofLayer unchanged").
 */
export function buildRevisionPrompt(input: ReviseDraftInput): string {
  if (input.critique.fixes.length === 0) {
    throw new Error('buildRevisionPrompt called with a critique that has no fixes -- nothing to revise.');
  }

  const fixLines = input.critique.fixes.map(
    (fix, index) => `${index + 1}. [${fix.category}] ${fix.issue} ${fix.suggestion}`
  );

  return [
    GROUNDING_RULES,
    'You are revising an existing draft. Fix ONLY the issues listed below. Keep every part of the draft that is not called out as an issue unchanged, including its facts, structure, and tone.',
    'Issues to fix:',
    fixLines.join('\n'),
    'Original draft:',
    input.fullText,
    'Return the full revised draft in the same output format as the original, with every listed fix applied and nothing else changed.',
  ].join('\n\n');
}
