import { phraseAppearsIn } from './preference-candidates';

export const MIN_INDEPENDENT_CASES = 3;
export const EVALUATOR_VERSION = 'v1';

export type EvaluationCaseClassification = 'supporting' | 'counter_evidence' | 'neutral' | 'invalid';

export interface DecidedActionForEvaluation {
  actionId: string;
  decision: 'approved' | 'rejected' | 'edited';
  draftContent: string;
  originalDraftContent?: string;
}

// Deterministic per-event-type classification -- see design doc's "Independent evidence" section
// for the reasoning behind each branch. Never calls an LLM; a case is either real evidence
// (supporting/counter_evidence) or it isn't (neutral/invalid) -- there is no probabilistic middle.
export function classifyEvaluationCase(
  action: DecidedActionForEvaluation,
  phrase: string,
  excludedActionIds: string[]
): EvaluationCaseClassification {
  if (excludedActionIds.includes(action.actionId)) return 'invalid';

  if (action.decision === 'rejected') return 'neutral';

  if (action.decision === 'approved') {
    return phraseAppearsIn(phrase, action.draftContent) ? 'counter_evidence' : 'neutral';
  }

  // edited
  if (!action.originalDraftContent) return 'neutral';
  if (!phraseAppearsIn(phrase, action.originalDraftContent)) return 'neutral';
  return phraseAppearsIn(phrase, action.draftContent) ? 'counter_evidence' : 'supporting';
}

export interface EvaluationCounts {
  supportingCount: number;
  counterCount: number;
  neutralCount: number;
}

export type EvaluationStatus = 'pending' | 'evaluating' | 'passed' | 'failed' | 'insufficient_evidence';

// Conservative by design: any real counter-evidence blocks a pass outright, since
// restrictedWording is a blanket customer-wide rule -- one confirmed exception is a real
// contradiction, not noise. See design doc's "Evaluation threshold, defined and justified".
export function decideEvaluationStatus(counts: EvaluationCounts): EvaluationStatus {
  const total = counts.supportingCount + counts.counterCount;
  if (total < MIN_INDEPENDENT_CASES) return 'insufficient_evidence';
  if (counts.counterCount > 0) return 'failed';
  return 'passed';
}
