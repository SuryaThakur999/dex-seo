import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ProofCheckResult } from './proof-layer';
import { db } from './db';
import { buildAuditLogEntryArgs } from './audit-log';
import { decrypt } from './crypto';
import { findObservedPagePerformance, GoogleAuthError, listPagePerformance } from './gsc-client';
import { recordEvaluationCase } from './preference-evaluation-events';
import { actionRevision, buildProofReceipt, buildReceiptSnapshot, type ActionWithOwnedWebsiteAndGuard, type ReceiptEvent } from './proof-receipt';

export type ActionDecision = 'approve' | 'reject' | 'edit' | 'revert';
export type DecideActionInput = {
  customerId: string;
  actorClerkUserId: string;
  actionId: string;
  decision: ActionDecision;
  draftContent?: string;
  expectedRevision?: string;
};
export type CapturedBaseline = { metrics: { impressions: number; clicks: number; ctr: number }; capturedAt: Date };

export class ActionDecisionError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = 'ActionDecisionError';
  }
}

export const actionDecisionInclude = {
  guardResult: true,
  website: { include: { clientProfile: { select: { id: true, customerId: true } } } },
} satisfies Prisma.ActionInclude;

function ownedBy(action: ActionWithOwnedWebsiteAndGuard, customerId: string): boolean {
  return action.customerId === customerId && action.website.id === action.websiteId &&
    action.website.clientProfileId === action.website.clientProfile.id && action.website.clientProfile.customerId === customerId;
}

function validGuard(checks: unknown, outcome: unknown, reasoning: unknown): checks is ProofCheckResult[] {
  if (!Array.isArray(checks) || checks.length === 0 || !['pass', 'flag', 'block'].includes(String(outcome)) || typeof reasoning !== 'string' || !reasoning.trim()) return false;
  return checks.every((check) => check && typeof check === 'object' &&
    typeof check.check === 'string' && !!check.check.trim() && typeof check.detail === 'string' && !!check.detail.trim() &&
    (check.result === 'pass' || check.result === 'fail'));
}

function assertDecisionAllowed(action: ActionWithOwnedWebsiteAndGuard, decision: ActionDecision, draftContent?: string, stale = false): void {
  if (decision === 'revert') {
    if (action.status === 'pending') throw new ActionDecisionError(stale ? 409 : 404, stale ? 'Action changed. Reload before deciding.' : 'Action not found or not yet decided');
    return;
  }
  if (action.status !== 'pending') throw new ActionDecisionError(stale ? 409 : 404, stale ? 'Action changed. Reload before deciding.' : 'Action not found or already decided');
  if (decision === 'edit' && (typeof draftContent !== 'string' || !draftContent.trim())) {
    throw new ActionDecisionError(400, 'Edited content cannot be empty');
  }
  if (decision === 'approve') {
    if (action.guardResult?.outcome === 'block') throw new ActionDecisionError(400, 'Blocked drafts cannot be approved');
    if (action.generationStatus !== 'succeeded' || !action.draftContent.trim() ||
        !action.guardResult || !validGuard(action.guardResult.checksRun, action.guardResult.outcome, action.guardResult.reasoning)) {
      throw new ActionDecisionError(400, 'Draft is not eligible for approval');
    }
  }
}

export async function lockDecisionScope(
  tx: Prisma.TransactionClient,
  customerId: string,
  websiteId: string,
  actionIds: string[]
): Promise<void> {
  const customers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`);
  if (customers.length === 0) throw new ActionDecisionError(404, 'Customer not found');
  const websites = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Website" WHERE "id" = ${websiteId} FOR UPDATE`);
  if (websites.length === 0) throw new ActionDecisionError(404, 'Website not found');
  for (const actionId of [...new Set(actionIds)].sort()) {
    const actions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Action" WHERE "id" = ${actionId} FOR UPDATE`);
    if (actions.length === 0) throw new ActionDecisionError(404, 'Action not found');
  }
}

function eventForAudit(action: ActionWithOwnedWebsiteAndGuard, input: DecideActionInput, decisionAt: Date, eventId: string) {
  const decision = input.decision === 'approve' ? 'approved' : input.decision === 'edit' ? 'edited' : 'rejected';
  const decidedContent = input.decision === 'edit' ? input.draftContent!.trim() : action.draftContent;
  const receiptSnapshot = buildReceiptSnapshot({
    action,
    decision,
    decidedContent,
    actorClerkUserId: input.actorClerkUserId,
    decidedAt: decisionAt,
  });
  return buildAuditLogEntryArgs(action.customerId, 'action_decided', {
    decision,
    pageUrl: action.pageUrl,
    ...(input.decision === 'edit' ? { originalDraftContent: action.draftContent } : {}),
    actorClerkUserId: input.actorClerkUserId,
    receiptSnapshot,
  }, action.id, { id: eventId, createdAt: decisionAt });
}

function toReceiptEvent(entry: { id: string; customerId: string; actionId: string | null; eventType: string; createdAt: Date; detail: unknown }): ReceiptEvent {
  return { ...entry, createdAt: entry.createdAt.toISOString() };
}

async function restoredEditedDraft(tx: Prisma.TransactionClient, action: ActionWithOwnedWebsiteAndGuard): Promise<string | undefined> {
  if (action.status !== 'edited' || !action.decidedAt) return undefined;
  const entries = await tx.auditLogEntry.findMany({
    where: { customerId: action.customerId, actionId: action.id, eventType: 'action_decided' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const events = entries.map(toReceiptEvent);
  const receipt = buildProofReceipt({ action, events });
  if (receipt.snapshot?.decision === 'edited' && receipt.snapshot.decidedAt === action.decidedAt.toISOString()) {
    return receipt.snapshot.preDecisionDraftContent;
  }
  const latest = entries[0];
  if (!latest || latest.createdAt.toISOString() !== action.decidedAt.toISOString()) return undefined;
  if (latest.detail && typeof latest.detail === 'object' && !Array.isArray(latest.detail)) {
    const detail = latest.detail as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(detail, 'receiptSnapshot') && detail.decision === 'edited' && typeof detail.originalDraftContent === 'string') {
      return detail.originalDraftContent;
    }
  }
  return undefined;
}

export async function applyDecisionInTransaction(
  tx: Prisma.TransactionClient,
  input: DecideActionInput,
  websiteId: string,
  baseline: CapturedBaseline | null,
  prereadRevision: string,
  decisionEventId: string
): Promise<{ actionId: string; action: ActionWithOwnedWebsiteAndGuard }> {
  await lockDecisionScope(tx, input.customerId, websiteId, [input.actionId]);
  const action = await tx.action.findUnique({ where: { id: input.actionId }, include: actionDecisionInclude });
  if (!action || action.websiteId !== websiteId || !ownedBy(action, input.customerId)) throw new ActionDecisionError(404, 'Action not found');
  if (actionRevision(action) !== prereadRevision || input.expectedRevision !== prereadRevision) {
    throw new ActionDecisionError(409, 'Action changed. Reload before deciding.');
  }
  assertDecisionAllowed(action, input.decision, input.draftContent, true);

  return writeDecisionInTransaction(tx, input, action, baseline, decisionEventId);
}

// Call only after scope locks and all requested revisions have been checked.
export async function writeDecisionInTransaction(
  tx: Prisma.TransactionClient,
  input: DecideActionInput,
  action: ActionWithOwnedWebsiteAndGuard,
  baseline: CapturedBaseline | null,
  decisionEventId: string
): Promise<{ actionId: string; action: ActionWithOwnedWebsiteAndGuard }> {

  if (input.decision === 'revert') {
    const restoredDraftContent = await restoredEditedDraft(tx, action);
    await tx.action.update({
      where: { id: action.id },
      data: {
        status: 'pending', decidedAt: null, baselinePerformance: Prisma.DbNull, baselineCapturedAt: null,
        outcomePerformance: Prisma.DbNull, outcomeMeasuredAt: null,
        ...(restoredDraftContent !== undefined ? { draftContent: restoredDraftContent } : {}),
      },
    });
    await tx.auditLogEntry.create(buildAuditLogEntryArgs(action.customerId, 'action_reverted', {
      from: action.status, pageUrl: action.pageUrl, restoredDraftContent, actorClerkUserId: input.actorClerkUserId,
    }, action.id, { id: randomUUID(), createdAt: new Date() }));
    return { actionId: action.id, action };
  }

  const decisionAt = new Date();
  const updateData: Prisma.ActionUpdateInput = {
    status: input.decision === 'approve' ? 'approved' : input.decision === 'edit' ? 'edited' : 'rejected',
    ...(input.decision === 'edit' ? { draftContent: input.draftContent!.trim() } : {}),
    decidedAt: decisionAt,
    baselinePerformance: baseline ? { ...baseline.metrics, captureVersion: 1, availability: 'observed_gsc_row', decisionEventId } : Prisma.DbNull,
    baselineCapturedAt: baseline?.capturedAt ?? null,
    outcomePerformance: Prisma.DbNull,
    outcomeMeasuredAt: null,
  };
  await tx.action.update({ where: { id: action.id }, data: updateData });
  await tx.auditLogEntry.create(eventForAudit(action, input, decisionAt, decisionEventId));
  return { actionId: action.id, action };
}

export async function decideAction(input: DecideActionInput): Promise<{ actionId: string }> {
  const action = await db.action.findUnique({ where: { id: input.actionId }, include: actionDecisionInclude });
  if (!action || !ownedBy(action, input.customerId)) throw new ActionDecisionError(404, 'Action not found');
  assertDecisionAllowed(action, input.decision, input.draftContent);
  const prereadRevision = actionRevision(action);
  if (input.expectedRevision !== prereadRevision) throw new ActionDecisionError(409, 'Action changed. Reload before deciding.');

  const decisionEventId = randomUUID();
  let baseline: CapturedBaseline | null = null;
  if ((input.decision === 'approve' || input.decision === 'edit') && action.website.gscRefreshToken &&
      !action.website.gscReconnectRequired && action.website.gscPropertyUrl) {
    try {
      const rows = await listPagePerformance(decrypt(action.website.gscRefreshToken), action.website.gscPropertyUrl);
      const metrics = findObservedPagePerformance(rows, action.pageUrl);
      if (metrics) baseline = { metrics, capturedAt: new Date() };
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        try {
          await db.website.updateMany({
            where: { id: action.websiteId, gscRefreshToken: action.website.gscRefreshToken },
            data: { gscReconnectRequired: true },
          });
        } catch (flagError) {
          console.error(`action-decision: failed to flag reconnect-required for website ${action.websiteId}`, flagError instanceof Error ? flagError.message : flagError);
        }
      }
    }
  }

  const result = await db.$transaction((tx) => applyDecisionInTransaction(tx, input, action.websiteId, baseline, prereadRevision, decisionEventId));

  if (input.decision !== 'revert') {
    const persistedDecision = input.decision === 'approve' ? 'approved' : input.decision === 'edit' ? 'edited' : 'rejected';
    await recordEvaluationCase(result.action.websiteId, {
      actionId: result.action.id,
      decision: persistedDecision,
      draftContent: input.decision === 'edit' ? input.draftContent!.trim() : result.action.draftContent,
      ...(input.decision === 'edit' ? { originalDraftContent: result.action.draftContent } : {}),
    });
  }
  return { actionId: result.actionId };
}
