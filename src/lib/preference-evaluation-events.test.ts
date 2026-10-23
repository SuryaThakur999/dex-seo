import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordEvaluationCase } from './preference-evaluation-events';
import { db } from './db';

vi.mock('./db', () => ({
  db: {
    preferenceEvaluation: { findMany: vi.fn(), update: vi.fn() },
    preferenceEvaluationCase: { create: vi.fn() },
  },
}));

function evaluation(overrides: Partial<{ id: string; evaluatedPhrase: string; excludedActionIds: string[]; supportingCount: number; counterCount: number; neutralCount: number; status: string }> = {}) {
  return {
    id: 'ev1',
    evaluatedPhrase: 'industry-leading',
    excludedActionIds: [],
    supportingCount: 0,
    counterCount: 0,
    neutralCount: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('recordEvaluationCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no in-progress evaluation exists for this website', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await recordEvaluationCase('w1', { actionId: 'a1', decision: 'approved', draftContent: 'text' });

    expect(db.preferenceEvaluationCase.create).not.toHaveBeenCalled();
  });

  it('records a supporting case via an atomic increment and updates status', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([evaluation({ supportingCount: 2 })]);
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      evaluation({ supportingCount: 3, status: 'pending' })
    );

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    expect(db.preferenceEvaluationCase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evaluationId: 'ev1', actionId: 'a1', classification: 'supporting' }) })
    );
    expect(db.preferenceEvaluation.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'ev1' },
      data: { supportingCount: { increment: 1 } },
    });
    expect(db.preferenceEvaluation.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'ev1' },
      data: { status: 'passed', completedAt: expect.any(Date) },
    });
  });

  it('skips the status write when the resolved status has not changed', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([evaluation({ supportingCount: 0, status: 'evaluating' })]);
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      evaluation({ supportingCount: 1, status: 'evaluating' })
    );

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    expect(db.preferenceEvaluation.update).toHaveBeenCalledTimes(1);
  });

  it('is idempotent -- a duplicate case (P2002) does not double-count', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([evaluation({ supportingCount: 5 })]);
    const { Prisma } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    );

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    expect(db.preferenceEvaluation.update).not.toHaveBeenCalled();
  });

  it('excludes an action in excludedActionIds -- records it as invalid, never counts it', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([evaluation({ excludedActionIds: ['a1'] })]);
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    expect(db.preferenceEvaluation.update).toHaveBeenCalledTimes(1);
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { status: 'evaluating' },
    });
  });

  it('leaves an invalid case with no status write when the evaluation is already evaluating', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      evaluation({ excludedActionIds: ['a1'], status: 'evaluating' }),
    ]);
    (db.preferenceEvaluationCase.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recordEvaluationCase('w1', {
      actionId: 'a1',
      decision: 'edited',
      draftContent: 'Our solution.',
      originalDraftContent: 'Our industry-leading solution.',
    });

    expect(db.preferenceEvaluation.update).not.toHaveBeenCalled();
  });

  it('never throws -- a DB failure is caught and swallowed, not surfaced to the caller', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection lost'));

    await expect(recordEvaluationCase('w1', { actionId: 'a1', decision: 'approved', draftContent: 'text' })).resolves.toBeUndefined();
  });
});
