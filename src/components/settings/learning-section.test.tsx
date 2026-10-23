import { describe, it, expect } from 'vitest';
import { formatCandidateStatusLabel, formatEvaluationStatusLabel } from './learning-section';

describe('formatCandidateStatusLabel', () => {
  it('maps every known internal status to honest customer wording', () => {
    expect(formatCandidateStatusLabel('proposed')).toBe('Pending');
    expect(formatCandidateStatusLabel('approved_for_evaluation')).toBe('Evaluating');
    expect(formatCandidateStatusLabel('rejected')).toBe('Not a preference');
    expect(formatCandidateStatusLabel('superseded')).toBe('Replaced by a newer suggestion');
  });

  it('falls back to the raw status for an unrecognized value rather than a made-up label', () => {
    expect(formatCandidateStatusLabel('some_future_status')).toBe('some_future_status');
  });
});

describe('formatEvaluationStatusLabel', () => {
  it('maps every known evaluation status to honest customer wording', () => {
    expect(formatEvaluationStatusLabel('pending')).toBe('Quality check in progress');
    expect(formatEvaluationStatusLabel('evaluating')).toBe('Quality check in progress');
    expect(formatEvaluationStatusLabel('insufficient_evidence')).toBe('More evidence needed');
    expect(formatEvaluationStatusLabel('passed')).toBe('Quality check passed — ready for activation');
    expect(formatEvaluationStatusLabel('failed')).toBe('Quality check did not pass');
  });

  it('falls back to the raw status for an unrecognized value', () => {
    expect(formatEvaluationStatusLabel('some_future_status')).toBe('some_future_status');
  });
});
