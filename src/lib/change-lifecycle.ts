// Real per-Action stage history — every stage is derived from a column this codebase already
// writes (Finding→draft is one combined Action row in this schema; there is no separate
// "finding" row to link back to for a meta_description Action). No "deployment status" stage:
// no publishing integration exists anywhere in this codebase, so that stage would be
// fabricated — "Ready to apply" (the real terminal state ActionDetail already uses) stands in
// for it honestly.

export type ChangeLifecycleStageKey = 'found' | 'drafted' | 'proof_layer' | 'reviewed' | 'ready_to_apply' | 'outcome_measured';

export interface ChangeLifecycleStage {
  key: ChangeLifecycleStageKey;
  label: string;
  reached: boolean;
  detail: string | null;
  at: Date | null;
}

interface ActionForLifecycle {
  createdAt: Date;
  generationStatus: string;
  guardResult: { outcome: string } | null;
  status: string;
  decidedAt: Date | null;
  outcomeMeasuredAt: Date | null;
}

export function computeChangeLifecycle(action: ActionForLifecycle): ChangeLifecycleStage[] {
  const reviewed = action.status !== 'pending' && action.decidedAt !== null;
  const readyToApply = action.status === 'approved' || action.status === 'edited';

  return [
    { key: 'found', label: 'Found', reached: true, detail: null, at: action.createdAt },
    {
      key: 'drafted',
      label: 'Drafted',
      reached: true,
      detail: action.generationStatus === 'succeeded' ? 'Draft generated' : 'Generation failed',
      at: action.createdAt,
    },
    {
      key: 'proof_layer',
      label: 'ProofLayer',
      reached: action.guardResult !== null,
      detail: action.guardResult?.outcome ?? null,
      at: null,
    },
    {
      key: 'reviewed',
      label: 'Reviewed',
      reached: reviewed,
      detail: reviewed ? action.status : null,
      at: action.decidedAt,
    },
    { key: 'ready_to_apply', label: 'Ready to apply', reached: readyToApply, detail: null, at: readyToApply ? action.decidedAt : null },
    { key: 'outcome_measured', label: 'Outcome measured', reached: action.outcomeMeasuredAt !== null, detail: null, at: action.outcomeMeasuredAt },
  ];
}
