import { describe, it, expect } from 'vitest';
import { computeChangeLifecycle } from './change-lifecycle';

const base = {
  createdAt: new Date('2026-09-01T00:00:00Z'),
  generationStatus: 'succeeded',
  guardResult: null as { outcome: string } | null,
  status: 'pending',
  decidedAt: null as Date | null,
  outcomeMeasuredAt: null as Date | null,
};

describe('computeChangeLifecycle', () => {
  it('marks only Found and Drafted reached for a fresh pending action', () => {
    const stages = computeChangeLifecycle(base);
    expect(stages.filter((s) => s.reached).map((s) => s.key)).toEqual(['found', 'drafted']);
  });

  it('reaches ProofLayer once a real guardResult exists', () => {
    const stages = computeChangeLifecycle({ ...base, guardResult: { outcome: 'pass' } });
    expect(stages.find((s) => s.key === 'proof_layer')?.reached).toBe(true);
    expect(stages.find((s) => s.key === 'proof_layer')?.detail).toBe('pass');
  });

  it('reaches Ready to apply only for approved or edited status, not pending or rejected', () => {
    const approved = computeChangeLifecycle({ ...base, status: 'approved', decidedAt: new Date() });
    expect(approved.find((s) => s.key === 'ready_to_apply')?.reached).toBe(true);

    const rejected = computeChangeLifecycle({ ...base, status: 'rejected', decidedAt: new Date() });
    expect(rejected.find((s) => s.key === 'ready_to_apply')?.reached).toBe(false);
    // Rejected is still a real reviewed decision, just not a ready-to-apply one.
    expect(rejected.find((s) => s.key === 'reviewed')?.reached).toBe(true);
  });

  it('reaches Outcome measured only with a real outcomeMeasuredAt', () => {
    const stages = computeChangeLifecycle({ ...base, outcomeMeasuredAt: new Date('2026-10-01T00:00:00Z') });
    expect(stages.find((s) => s.key === 'outcome_measured')?.reached).toBe(true);
  });

  it('never fabricates a deployment stage — no such key exists', () => {
    const stages = computeChangeLifecycle(base);
    expect(stages.some((s) => s.label.toLowerCase().includes('deploy'))).toBe(false);
  });
});
