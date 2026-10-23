import { randomUUID, createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { GENERATION_PROVIDER, GENERATION_MODEL, isRateLimitError, getRetryAfterMs } from '@/lib/openai-client';
import { checkBreaker, recordSuccess, recordFailure } from '@/lib/circuit-breaker';
import { runGenerator, type GenerationContext } from '@/lib/generation-dispatch';
import { computeIdempotencyKey, type GenerationPayload } from '@/lib/generation-payload';
import { getCustomerSafeGenerationError } from '@/lib/customer-safe-error';
import { lockDecisionScope } from '@/lib/action-decision';

// Phase 1C (docs/superpowers/specs/2026-09-28-phase1c-generation-queue-adr.md): the durable job
// engine for the 6 run-scan.ts actionTypes + retry-draft. Mirrors scan-worker.ts's own
// claim/run/record shape (atomic `updateMany` claim, try/catch around the real work) -- same
// established pattern, extended with the retry/backoff/breaker machinery scans never needed
// (a scan has no per-attempt external-provider dependency the way a generation call does).

// SDK's own `maxRetries: 2` (openai-client.ts) already absorbs one flaky call inside a single
// attempt -- 3 job-level attempts on top of that is a real ceiling at this volume (~30
// generation attempts/scan, ~5 scans/day), not an arbitrary number.
const GENERATION_MAX_ATTEMPTS = 3;
// Backoff before re-claiming a `waiting_retry` job, indexed by (attempts - 1) at the time of
// the failure that produced it. Fixed, not exponential -- real volume here doesn't justify
// more than two short waits before the final attempt either succeeds or gives up.
const RETRY_BACKOFF_MS = [30_000, 120_000];
// A `waiting_retry` fallback when the provider's 429 didn't include a Retry-After header --
// matches CUSTOMER_SAFE_RATE_LIMIT_ERROR's own "try again in a minute" wording.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;
// Every real generator call in this codebase completes in low single-digit seconds (no real
// generation call here does meaningful I/O beyond one LLM round trip) -- a job stuck `running`
// this long was killed by the platform mid-attempt, not still legitimately working.
const STALE_RUNNING_MINUTES = 2;

export type GenerationOutcomeStatus = 'completed' | 'failed' | 'waiting_retry' | 'rate_limited' | 'blocked' | 'cancelled';

export interface EnqueueGenerationJobInput {
  customerId: string;
  websiteId: string;
  actionType: string;
  targetRef: string;
  inputFingerprint: string;
  payload: GenerationPayload;
}

// Resets a job back to a fresh `queued` state -- shared by both terminal-failure recovery and
// the completed-but-resolved-elsewhere case below, since both mean "this row's content is
// eligible for a brand-new attempt."
async function resetJobToQueued(jobId: string, clearResultAction: boolean): Promise<void> {
  await db.generationJob.update({
    where: { id: jobId },
    data: {
      status: 'queued',
      attempts: 0,
      lastError: null,
      nextRetryAt: null,
      startedAt: null,
      completedAt: null,
      cancelRequested: false,
      ...(clearResultAction ? { resultActionId: null } : {}),
    },
  });
}

export async function enqueueGenerationJob(input: EnqueueGenerationJobInput): Promise<{ id: string }> {
  const idempotencyKey = computeIdempotencyKey(input.customerId, input.websiteId, input.actionType, input.targetRef, input.inputFingerprint);

  let existing = await db.generationJob.findUnique({ where: { idempotencyKey } });
  if (!existing) {
    try {
      const created = await db.generationJob.create({
        data: {
          customerId: input.customerId,
          websiteId: input.websiteId,
          actionType: input.actionType,
          targetRef: input.targetRef,
          idempotencyKey,
          payload: input.payload as unknown as Prisma.InputJsonValue,
        },
      });
      return { id: created.id };
    } catch (err) {
      // Two concurrent first-time enqueues of the same not-yet-existing idempotencyKey (e.g. a
      // customer's manual retry-draft click landing the same moment a background scan
      // re-processes the same page -- realistic, since nothing stops a customer from retrying
      // an old finding while a fresh scan they also triggered is still running) both see
      // `existing === null` and both attempt create() -- the loser hits this unique-constraint
      // violation instead of throwing an unhandled exception up to the caller. Re-fetch (the
      // winner's row is now guaranteed to exist) and fall through to the same existing-job
      // handling below, exactly as if this call had found it on the first read.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      existing = await db.generationJob.findUniqueOrThrow({ where: { idempotencyKey } });
    }
  }

  // A job already sitting in a terminal end-state (attempts exhausted, or cancelled) for this
  // exact content must be restartable -- the caller (run-scan.ts's own dedup checks, or a
  // customer's manual retry-draft click) already decided a fresh attempt is warranted before
  // ever calling this, and both of those callers document their own "a failed page must stay
  // eligible to be picked back up" guarantee, which a permanently-stuck job would silently
  // break for any content that never changes between attempts.
  if (existing.status === 'failed' || existing.status === 'cancelled') {
    await resetJobToQueued(existing.id, false);
    return { id: existing.id };
  }

  // A `completed` job's downstream Action may since have been resolved (approved/edited/
  // rejected) by the customer. For restricted_wording_fix and internal_link_fix, the caller's
  // own dedup guard only blocks on a *pending* Action (see alreadyPendingRwf/alreadyPendingIlf
  // in run-scan.ts) -- specifically so a resolved decision doesn't block a genuinely new finding
  // of the same underlying issue on a later scan. Leaving this job `completed` forever once its
  // Action is resolved would silently defeat that guard: the idempotency key is unchanged (same
  // content), so every future enqueue would keep resolving to this same permanently-`completed`
  // row and nothing would ever run again. A job whose Action is still `pending` (still awaiting
  // review) or one that's still in flight is left untouched -- there's genuinely nothing new to
  // do yet.
  if (existing.status === 'completed' && existing.resultActionId) {
    const resultAction = await db.action.findUnique({ where: { id: existing.resultActionId }, select: { status: true } });
    if (!resultAction || resultAction.status !== 'pending') {
      await resetJobToQueued(existing.id, true);
    }
  }

  return { id: existing.id };
}

function deriveFailureCurrentValue(payload: GenerationPayload): string | null {
  switch (payload.actionType) {
    case 'meta_description':
      return payload.metaDescription;
    case 'restricted_wording_fix':
      return payload.matches.map((m) => m.excerpt).join('\n');
    case 'canonical_fix':
      return payload.currentCanonical;
    case 'structured_data_fix':
    case 'entity_markup_fix':
    case 'internal_link_fix':
      return null;
  }
}

async function buildGenerationContext(customerId: string, websiteId: string, actionType: string, targetRef: string): Promise<GenerationContext> {
  const website = await db.website.findUniqueOrThrow({ where: { id: websiteId }, select: { clientProfileId: true, autoExecuteEnabled: true } });
  const [clientProfile, approvedFactRows] = await Promise.all([
    db.clientProfile.findUnique({ where: { id: website.clientProfileId }, select: { restrictedWording: true, name: true } }),
    db.customerFact.findMany({ where: { customerId }, select: { claim: true } }),
  ]);

  // Matches run-scan.ts's own RECENT_DRAFTS_LIMIT query -- only meta_description's ProofLayer
  // duplicate-detection check uses this; every other actionType passes an empty list, unchanged
  // from today's behavior.
  let recentDraftsForCustomer: string[] | undefined;
  if (actionType === 'meta_description') {
    const recentActions = await db.action.findMany({
      where: { websiteId, actionType: 'meta_description', pageUrl: { not: targetRef } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { draftContent: true },
    });
    recentDraftsForCustomer = recentActions.map((a) => a.draftContent);
  }

  return {
    autoExecuteEnabled: website.autoExecuteEnabled,
    approvedFacts: approvedFactRows.map((f) => f.claim),
    restrictedWording: clientProfile?.restrictedWording ?? [],
    clientProfileName: clientProfile?.name ?? null,
    clientProfileId: website.clientProfileId,
    recentDraftsForCustomer,
  };
}

export async function claimAndRunGenerationJob(jobId: string): Promise<{ processed: boolean; outcome?: GenerationOutcomeStatus }> {
  const claimed = await db.generationJob.updateMany({
    where: { id: jobId, status: { in: ['queued', 'waiting_retry', 'rate_limited', 'blocked'] } },
    data: { status: 'running', startedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { processed: false };
  }

  const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });

  if (job.cancelRequested) {
    await db.generationJob.update({ where: { id: job.id }, data: { status: 'cancelled', completedAt: new Date() } });
    return { processed: true, outcome: 'cancelled' };
  }

  const breakerCheck = await checkBreaker(GENERATION_PROVIDER, GENERATION_MODEL);
  if (breakerCheck.blocked) {
    // Not a real attempt -- every other job queued behind an open breaker moves straight to
    // `blocked` without ever reaching the provider, which is what actually prevents repeated
    // calls to a failing provider (see the ADR's "Persisted circuit breaker" section).
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: 'blocked', nextRetryAt: breakerCheck.retryAt, provider: GENERATION_PROVIDER, model: GENERATION_MODEL },
    });
    return { processed: true, outcome: 'blocked' };
  }

  const attempts = job.attempts + 1;
  await db.generationJob.update({
    where: { id: job.id },
    data: { attempts, provider: GENERATION_PROVIDER, model: GENERATION_MODEL },
  });

  // One identity per real attempt -- a retry gets its own ActionProvenance row, never
  // overwrites a prior attempt's. See the wiring note's gate 4/5 section.
  const executionId = randomUUID();
  const payload = job.payload as unknown as GenerationPayload;
  const ctx = await buildGenerationContext(job.customerId, job.websiteId, job.actionType, job.targetRef);
  const targetedFailedAction = await db.action.findFirst({
    where: {
      customerId: job.customerId,
      websiteId: job.websiteId,
      pageUrl: job.targetRef,
      actionType: job.actionType,
      status: 'pending',
      generationStatus: 'failed',
    },
    select: { id: true },
  });

  try {
    const outcome = await runGenerator(payload, ctx);
    const guardResultData = {
      outcome: outcome.guardResult.outcome,
      checksRun: outcome.guardResult.checksRun as Prisma.InputJsonValue,
      reasoning: outcome.guardResult.reasoning,
    };
    const actionData = {
      customerId: job.customerId,
      websiteId: job.websiteId,
      pageUrl: job.targetRef,
      actionType: job.actionType,
      currentValue: outcome.currentValue,
      draftContent: outcome.draftContent,
      aiDisclosure: outcome.aiDisclosure,
      status: outcome.status,
      riskTier: outcome.riskTier,
      policyVersion: 'v1',
      tokenCost: outcome.tokenCost,
      generationStatus: 'succeeded' as const,
      generationError: null,
    };

    let cancelledByDecision = false;
    await db.$transaction(async (tx) => {
      await lockDecisionScope(tx, job.customerId, job.websiteId, targetedFailedAction ? [targetedFailedAction.id] : []);
      const lockedWebsite = await tx.website.findUnique({ where: { id: job.websiteId }, select: { clientProfile: { select: { customerId: true } } } });
      if (!lockedWebsite || lockedWebsite.clientProfile.customerId !== job.customerId) {
        cancelledByDecision = true;
        await tx.generationJob.update({ where: { id: job.id }, data: { status: 'cancelled', completedAt: new Date() } });
        return;
      }
      let actionId: string;
      if (targetedFailedAction) {
        const lockedAction = await tx.action.findUnique({ where: { id: targetedFailedAction.id } });
        if (!lockedAction || lockedAction.customerId !== job.customerId || lockedAction.websiteId !== job.websiteId ||
            lockedAction.status !== 'pending' || lockedAction.generationStatus !== 'failed') {
          cancelledByDecision = true;
          await tx.generationJob.update({ where: { id: job.id }, data: { status: 'cancelled', completedAt: new Date() } });
          return;
        }
        actionId = (await tx.action.update({
          where: { id: lockedAction.id },
          data: { ...actionData, guardResult: { upsert: { create: guardResultData, update: guardResultData } } },
        })).id;
      } else {
        actionId = (await tx.action.create({ data: { ...actionData, guardResult: { create: guardResultData } } })).id;
      }

      // ActionProvenance: success path only, per
      // docs/superpowers/plans/2026-10-12-action-provenance-producer-wiring-note.md. A causal
      // Finding link is only created once its customerId/websiteId are re-checked here against
      // this job's own scope -- payload.findingId is untrusted input (it was captured at
      // enqueue time, potentially stale) until verified inside this same transaction.
      let findingAssociation = outcome.provenance.findingAssociation;
      let associationReason = outcome.provenance.associationReason;
      const findingLinks: Array<{
        findingId: string;
        ruleId: string;
        ruleVersion: string;
        agent: string;
        pageUrl: string;
        evidence: Prisma.InputJsonValue;
        limitations: string | null;
        retrievedAt: Date;
      }> = [];
      if (findingAssociation === 'causal' && payload.findingId) {
        const finding = await tx.finding.findUnique({ where: { id: payload.findingId } });
        if (finding && finding.customerId === job.customerId && finding.websiteId === job.websiteId) {
          findingLinks.push({
            findingId: finding.id,
            ruleId: finding.ruleId,
            ruleVersion: finding.ruleVersion,
            agent: finding.agent,
            pageUrl: finding.pageUrl,
            evidence: finding.evidence as Prisma.InputJsonValue,
            limitations: finding.limitations,
            retrievedAt: finding.retrievedAt,
          });
        } else {
          findingAssociation = 'unavailable';
          associationReason = finding
            ? 'Finding belongs to a different customer/website than this job -- not linked'
            : 'Finding id captured at enqueue time no longer resolves';
        }
      }

      await tx.actionProvenance.create({
        data: {
          executionId,
          customerId: job.customerId,
          websiteId: job.websiteId,
          clientProfileIdAtExecution: ctx.clientProfileId,
          actionId,
          generationJobId: job.id,
          attemptNumber: attempts,
          actionType: job.actionType,
          producerKind: outcome.provenance.producerKind,
          producerVersion: outcome.provenance.producerVersion,
          provider: outcome.provenance.producerKind === 'model' ? GENERATION_PROVIDER : null,
          model: outcome.provenance.producerKind === 'model' ? GENERATION_MODEL : null,
          findingAssociation,
          associationReason,
          enqueueInputsSnapshot: payload as unknown as Prisma.InputJsonValue,
          enqueueInputsVersion: 'v1',
          generatorInputsSnapshot: outcome.provenance.generatorInputsSnapshot as Prisma.InputJsonValue,
          generatorInputsVersion: outcome.provenance.generatorInputsVersion,
          validatorInputsSnapshot:
            outcome.provenance.validatorInputsSnapshot === null
              ? Prisma.JsonNull
              : (outcome.provenance.validatorInputsSnapshot as Prisma.InputJsonValue),
          validatorInputsVersion: outcome.provenance.validatorInputsVersion,
          inputsCapturedAt: new Date(),
          inputsDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
          checkedBytes: outcome.draftContent,
          checkedBytesSha256: createHash('sha256').update(outcome.draftContent, 'utf8').digest('hex'),
          validatorKind: job.actionType,
          checkedAt: new Date(),
          guardOutcome: outcome.guardResult.outcome,
          checksRun: outcome.guardResult.checksRun as Prisma.InputJsonValue,
          reasoning: outcome.guardResult.reasoning,
          findings: findingLinks.length > 0 ? { create: findingLinks } : undefined,
        },
      });

      await tx.generationJob.update({
        where: { id: job.id },
        data: { status: 'completed', completedAt: new Date(), resultActionId: actionId },
      });
    });

    if (cancelledByDecision) return { processed: true, outcome: 'cancelled' };
    await recordSuccess(GENERATION_PROVIDER, GENERATION_MODEL);
    return { processed: true, outcome: 'completed' };
  } catch (err) {
    console.error(`Generation job ${job.id} (${job.actionType}, ${job.targetRef}) failed on attempt ${attempts}`, err);
    await recordFailure(GENERATION_PROVIDER, GENERATION_MODEL);

    const retryAfterMs = getRetryAfterMs(err);
    if (isRateLimitError(err)) {
      await db.generationJob.update({
        where: { id: job.id },
        data: {
          status: 'rate_limited',
          nextRetryAt: new Date(Date.now() + (retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS)),
          lastError: getCustomerSafeGenerationError(err),
        },
      });
      return { processed: true, outcome: 'rate_limited' };
    }

    if (attempts >= GENERATION_MAX_ATTEMPTS) {
      const customerSafeError = getCustomerSafeGenerationError(err);
      // One transaction, same reason as the success path above: a crash between the Action
      // write and the job's `failed` update would otherwise leave the job stuck `running` until
      // the stale reaper resets it to `waiting_retry`, letting the next claim re-run generation
      // one more time than GENERATION_MAX_ATTEMPTS allows.
      let cancelledByDecision = false;
      await db.$transaction(async (tx) => {
        await lockDecisionScope(tx, job.customerId, job.websiteId, targetedFailedAction ? [targetedFailedAction.id] : []);
        const lockedWebsite = await tx.website.findUnique({ where: { id: job.websiteId }, select: { clientProfile: { select: { customerId: true } } } });
        if (!lockedWebsite || lockedWebsite.clientProfile.customerId !== job.customerId) {
          cancelledByDecision = true;
          await tx.generationJob.update({ where: { id: job.id }, data: { status: 'cancelled', completedAt: new Date() } });
          return;
        }
        if (targetedFailedAction) {
          const lockedAction = await tx.action.findUnique({ where: { id: targetedFailedAction.id } });
          if (!lockedAction || lockedAction.customerId !== job.customerId || lockedAction.websiteId !== job.websiteId ||
              lockedAction.status !== 'pending' || lockedAction.generationStatus !== 'failed') {
            cancelledByDecision = true;
            await tx.generationJob.update({ where: { id: job.id }, data: { status: 'cancelled', completedAt: new Date() } });
            return;
          }
          await tx.action.update({ where: { id: lockedAction.id }, data: { generationError: customerSafeError } });
        } else {
          await tx.action.create({
            data: {
              customerId: job.customerId,
              websiteId: job.websiteId,
              pageUrl: job.targetRef,
              actionType: job.actionType,
              currentValue: deriveFailureCurrentValue(payload),
              draftContent: '',
              // Deterministic actionTypes (canonical_fix/structured_data_fix/entity_markup_fix)
              // have no provider call and can't reach this path in practice — true is correct
              // for every actionType that actually can.
              aiDisclosure: true,
              status: 'pending',
              riskTier: 'low',
              policyVersion: 'v1',
              tokenCost: null,
              generationStatus: 'failed',
              generationError: customerSafeError,
            },
          });
        }
        await tx.generationJob.update({
          where: { id: job.id },
          data: { status: 'failed', completedAt: new Date(), lastError: customerSafeError },
        });
      });
      if (cancelledByDecision) return { processed: true, outcome: 'cancelled' };
      return { processed: true, outcome: 'failed' };
    }

    const backoffMs = RETRY_BACKOFF_MS[attempts - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: 'waiting_retry', nextRetryAt: new Date(Date.now() + backoffMs), lastError: getCustomerSafeGenerationError(err) },
    });
    return { processed: true, outcome: 'waiting_retry' };
  }
}

// Same stale-reaper pattern /api/scan/process already uses for ScanJob -- a job stuck `running`
// longer than any real generation call should ever take was almost certainly killed by the
// platform's function timeout mid-attempt. Reset to `waiting_retry` for immediate re-claim
// rather than incrementing attempts again here -- the claim step already counted this attempt
// when it first ran; only a real subsequent attempt should count again.
export async function reapStaleGenerationJobs(): Promise<void> {
  await db.generationJob.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MINUTES * 60 * 1000) } },
    data: { status: 'waiting_retry', nextRetryAt: new Date() },
  });
}
