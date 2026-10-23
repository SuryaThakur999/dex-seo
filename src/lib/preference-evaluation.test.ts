import { describe, it, expect } from 'vitest';
import { classifyEvaluationCase, decideEvaluationStatus, MIN_INDEPENDENT_CASES } from './preference-evaluation';

describe('classifyEvaluationCase', () => {
  const phrase = 'industry-leading';

  it('classifies a rejected action as neutral regardless of phrase presence', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'rejected', draftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an approved action containing the phrase as counter_evidence', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'approved', draftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('counter_evidence');
  });

  it('classifies an approved action without the phrase as neutral', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'approved', draftContent: 'Our solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an edited action that removed the phrase as supporting', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our solution.', originalDraftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('supporting');
  });

  it('classifies an edited action that kept the phrase as counter_evidence', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our industry-leading solution, updated.', originalDraftContent: 'Our industry-leading solution.' },
      phrase,
      []
    );
    expect(result).toBe('counter_evidence');
  });

  it('classifies an edited action whose original text never had the phrase as neutral', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our updated solution.', originalDraftContent: 'Our solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an edited action missing originalDraftContent as neutral, never throws', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our solution.' },
      phrase,
      []
    );
    expect(result).toBe('neutral');
  });

  it('classifies an excluded (inference-source) action as invalid regardless of content', () => {
    const result = classifyEvaluationCase(
      { actionId: 'a1', decision: 'edited', draftContent: 'Our solution.', originalDraftContent: 'Our industry-leading solution.' },
      phrase,
      ['a1']
    );
    expect(result).toBe('invalid');
  });
});

describe('decideEvaluationStatus', () => {
  it('is insufficient_evidence below MIN_INDEPENDENT_CASES total', () => {
    expect(decideEvaluationStatus({ supportingCount: 2, counterCount: 0, neutralCount: 5 })).toBe('insufficient_evidence');
  });

  it('is passed at the threshold with zero counter-evidence', () => {
    expect(decideEvaluationStatus({ supportingCount: MIN_INDEPENDENT_CASES, counterCount: 0, neutralCount: 0 })).toBe('passed');
  });

  it('is failed when any counter-evidence exists, even with strong supporting evidence', () => {
    expect(decideEvaluationStatus({ supportingCount: 10, counterCount: 1, neutralCount: 0 })).toBe('failed');
  });

  it('is insufficient_evidence when counter-evidence exists but total is still below the floor', () => {
    expect(decideEvaluationStatus({ supportingCount: 1, counterCount: 1, neutralCount: 0 })).toBe('insufficient_evidence');
  });
});
