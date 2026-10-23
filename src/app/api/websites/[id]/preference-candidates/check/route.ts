import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { extractEligibleEdits, computeSourceFingerprint, MIN_EDITS_FOR_SUMMARY } from '@/lib/feedback-analysis';
import { verifyCandidatePhrase, proposeCandidate, CANDIDATE_MODEL, CANDIDATE_PROMPT_VERSION } from '@/lib/preference-candidates';

const TARGET_FIELD = 'restrictedWording';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, params.id));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  const editedActions = await db.action.findMany({
    where: { websiteId: website.id, status: 'edited' },
    select: { id: true, actionType: true, draftContent: true },
  });
  const actionsById = new Map(editedActions.map((a) => [a.id, { actionType: a.actionType, draftContent: a.draftContent }]));

  const auditEntries = await db.auditLogEntry.findMany({
    where: { actionId: { in: editedActions.map((a) => a.id) }, eventType: 'action_decided' },
    select: { id: true, actionId: true, detail: true, createdAt: true },
  });

  const eligibleEdits = extractEligibleEdits(auditEntries, actionsById);

  if (eligibleEdits.length < MIN_EDITS_FOR_SUMMARY) {
    return NextResponse.json({ outcome: 'below_threshold' });
  }

  const fingerprint = computeSourceFingerprint(eligibleEdits);
  const checkWhere = { websiteId: website.id, clientProfileId: website.clientProfileId, targetField: TARGET_FIELD };

  // Atomic claim: an UPDATE only matches (and only one concurrent request can win it) when the
  // stored fingerprint differs from the live one -- Postgres serializes concurrent UPDATEs on
  // the same row. If nothing matched, either no row exists yet or another request just won this
  // exact claim; try CREATE next, and if that also loses (P2002, another request beat us to the
  // first-ever row), re-read and return whatever the winner recorded. This closes the TOCTOU
  // window between "is this fingerprint new" and "record that we're handling it" with no new
  // table and no advisory lock -- just the row's own uniqueness as the lock.
  const claimed = await db.preferenceCandidateCheck.updateMany({
    where: { ...checkWhere, lastFingerprint: { not: fingerprint } },
    data: { lastFingerprint: fingerprint, lastOutcome: 'pending', checkedAt: new Date() },
  });

  let wonClaim = claimed.count === 1;
  if (!wonClaim) {
    try {
      await db.preferenceCandidateCheck.create({
        data: { ...checkWhere, lastFingerprint: fingerprint, lastOutcome: 'pending', lastCandidateId: null },
      });
      wonClaim = true;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
  }

  if (!wonClaim) {
    const current = await db.preferenceCandidateCheck.findUnique({ where: { websiteId_clientProfileId_targetField: checkWhere } });
    return NextResponse.json({ outcome: current?.lastOutcome ?? 'no_pattern' });
  }

  const clientProfile = await db.clientProfile.findUnique({
    where: { id: website.clientProfileId },
    select: { restrictedWording: true },
  });

  const existingCandidates = await db.preferenceCandidate.findMany({
    where: { websiteId: website.id, clientProfileId: website.clientProfileId, targetField: TARGET_FIELD, status: { in: ['proposed', 'approved_for_evaluation', 'rejected'] } },
    select: { id: true, originalProposedPhrase: true, customerEditedPhrase: true, status: true },
  });
  const existingPhrases = existingCandidates.map((c) => c.customerEditedPhrase ?? c.originalProposedPhrase);

  const proposal = await proposeCandidate(eligibleEdits);

  let outcome: 'candidate_created' | 'no_pattern' = 'no_pattern';
  let createdCandidate: { id: string; originalProposedPhrase: string; rationale: string; evidenceExcerpts: unknown } | null = null;

  if (proposal) {
    const verification = verifyCandidatePhrase(proposal.phrase, eligibleEdits, existingPhrases, clientProfile?.restrictedWording ?? []);
    if (verification.valid) {
      const supportingEdits = eligibleEdits.filter((e) => verification.supportingEditIds.includes(e.auditLogEntryId));

      // A prior `proposed` candidate for this scope is superseded, not silently discarded,
      // when a fresh check produces a materially different phrase.
      const priorProposed = existingCandidates.find((c) => c.status === 'proposed');

      createdCandidate = await db.preferenceCandidate.create({
        data: {
          clientProfileId: website.clientProfileId,
          websiteId: website.id,
          targetField: TARGET_FIELD,
          originalProposedPhrase: proposal.phrase,
          rationale: proposal.rationale,
          evidenceEntryIds: verification.supportingEditIds,
          evidenceExcerpts: supportingEdits.map((e) => ({ auditLogEntryId: e.auditLogEntryId, before: e.before, after: e.after })),
          status: 'proposed',
          sourceFingerprint: fingerprint,
          modelVersion: CANDIDATE_MODEL,
          promptVersion: CANDIDATE_PROMPT_VERSION,
        },
      });

      if (priorProposed) {
        await db.preferenceCandidate.update({
          where: { id: priorProposed.id },
          data: { status: 'superseded', supersededById: createdCandidate.id, decidedAt: new Date() },
        });
      }

      outcome = 'candidate_created';
    }
  }

  await db.preferenceCandidateCheck.update({
    where: { websiteId_clientProfileId_targetField: checkWhere },
    data: { lastOutcome: outcome, lastCandidateId: createdCandidate?.id ?? null },
  });

  return NextResponse.json({
    outcome,
    ...(createdCandidate
      ? { candidate: { id: createdCandidate.id, originalProposedPhrase: createdCandidate.originalProposedPhrase, rationale: createdCandidate.rationale, evidenceExcerpts: createdCandidate.evidenceExcerpts } }
      : {}),
  });
}
