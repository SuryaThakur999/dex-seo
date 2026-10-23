import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { EVALUATOR_VERSION } from '@/lib/preference-evaluation';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { decision, editedPhrase } = body as { decision: 'evaluate' | 'reject'; editedPhrase?: string };

  if (decision !== 'evaluate' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be "evaluate" or "reject"' }, { status: 400 });
  }

  const candidate = await db.preferenceCandidate.findUnique({
    where: { id: params.id },
    include: { clientProfile: { select: { customerId: true } } },
  });

  if (!candidate || candidate.clientProfile.customerId !== customer.id) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (candidate.status !== 'proposed') {
    return NextResponse.json({ error: 'This candidate has already been decided.' }, { status: 400 });
  }

  const status = decision === 'evaluate' ? 'approved_for_evaluation' : 'rejected';

  const updated = await db.preferenceCandidate.update({
    where: { id: params.id },
    data: {
      status,
      customerEditedPhrase: decision === 'evaluate' ? editedPhrase : undefined,
      decidedAt: new Date(),
    },
  });

  if (status === 'approved_for_evaluation') {
    // candidate.evidenceEntryIds holds AuditLogEntry.id values (see preference-candidates.ts's
    // supportingEditIds), not Action.id -- classifyEvaluationCase excludes by Action.id, so the
    // two must be translated here or the exclusion silently never matches anything.
    const evidenceEntries = await db.auditLogEntry.findMany({
      where: { id: { in: candidate.evidenceEntryIds } },
      select: { actionId: true },
    });
    const excludedActionIds = evidenceEntries
      .map((e) => e.actionId)
      .filter((id): id is string => id !== null);

    await db.preferenceEvaluation.create({
      data: {
        candidateId: candidate.id,
        clientProfileId: candidate.clientProfileId,
        websiteId: candidate.websiteId,
        targetField: candidate.targetField,
        evaluatedPhrase: editedPhrase ?? candidate.originalProposedPhrase,
        excludedActionIds,
        status: 'pending',
        evaluatorVersion: EVALUATOR_VERSION,
        sourceFingerprint: candidate.sourceFingerprint,
      },
    });
  }

  return NextResponse.json({ status: updated.status });
}
