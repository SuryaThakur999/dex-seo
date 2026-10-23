import { Prisma } from '@prisma/client';
import { db } from './db';
import { classifyEvaluationCase, decideEvaluationStatus, type DecidedActionForEvaluation } from './preference-evaluation';

export async function recordEvaluationCase(websiteId: string, action: DecidedActionForEvaluation): Promise<void> {
  try {
    const evaluations = await db.preferenceEvaluation.findMany({
      where: { websiteId, status: { in: ['pending', 'evaluating'] } },
    });

    for (const evaluation of evaluations) {
      const classification = classifyEvaluationCase(action, evaluation.evaluatedPhrase, evaluation.excludedActionIds);

      try {
        await db.preferenceEvaluationCase.create({
          data: { evaluationId: evaluation.id, actionId: action.actionId, classification },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // already recorded
        throw err;
      }

      // An invalid (inference-source) case is recorded for idempotency but never counted in
      // any bucket -- only the pending -> evaluating nudge applies, so a stream of excluded
      // actions can never move an evaluation toward passed/failed on its own.
      if (classification === 'invalid') {
        if (evaluation.status === 'pending') {
          await db.preferenceEvaluation.update({ where: { id: evaluation.id }, data: { status: 'evaluating' } });
        }
        continue;
      }

      // Atomic increment, not a read-modify-write on the value already in `evaluation` --
      // two different actions for the same evaluation can be decided concurrently, and a
      // plain `evaluation.supportingCount + 1` write would lose one of the two increments.
      const countField =
        classification === 'supporting' ? 'supportingCount' : classification === 'counter_evidence' ? 'counterCount' : 'neutralCount';
      const updatedEvaluation = await db.preferenceEvaluation.update({
        where: { id: evaluation.id },
        data: { [countField]: { increment: 1 } },
      });

      const status = decideEvaluationStatus({
        supportingCount: updatedEvaluation.supportingCount,
        counterCount: updatedEvaluation.counterCount,
        neutralCount: updatedEvaluation.neutralCount,
      });
      const resolvedStatus = status === 'insufficient_evidence' ? 'evaluating' : status;

      if (resolvedStatus !== updatedEvaluation.status) {
        await db.preferenceEvaluation.update({
          where: { id: evaluation.id },
          data: {
            status: resolvedStatus,
            ...(resolvedStatus === 'passed' || resolvedStatus === 'failed' ? { completedAt: new Date() } : {}),
          },
        });
      }
    }
  } catch (err) {
    console.error('recordEvaluationCase failed, not surfaced to the decision route:', err instanceof Error ? err.message : err);
  }
}
