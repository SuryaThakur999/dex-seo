import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { buildAuditLogEntryArgs } from './audit-log';
import { actionDecisionInclude, ActionDecisionError, lockDecisionScope, writeDecisionInTransaction, type CapturedBaseline } from './action-decision';
import { decrypt } from './crypto';
import { findObservedPagePerformance, listPagePerformance } from './gsc-client';
import { recordEvaluationCase } from './preference-evaluation-events';
import { actionRevision, type ActionWithOwnedWebsiteAndGuard } from './proof-receipt';
export { actionRevision } from './proof-receipt';

export type BatchRequest = {
  requestId: string;
  websiteId: string;
  decision: 'approve' | 'reject';
  items: { actionId: string; revision: string }[];
};

export type BatchResult = { requestId: string; decision: 'approve' | 'reject'; actionIds: string[] };

export type BatchPreview = {
  groupKey: string;
  websiteId: string;
  clientProfileId: string;
  sharedCurrentValue: string | null;
  sharedDraftContent: string;
  items: { actionId: string; pageUrl: string; revision: string }[];
};

export class BatchRequestError extends Error {
  readonly status = 400;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function eligible(action: ActionWithOwnedWebsiteAndGuard): boolean {
  const guard = action.guardResult;
  return action.actionType === 'meta_description' && action.status === 'pending' &&
    action.generationStatus === 'succeeded' && nonblank(action.draftContent) && action.riskTier === 'low' &&
    action.website.id === action.websiteId && action.website.clientProfileId === action.website.clientProfile.id &&
    action.customerId === action.website.clientProfile.customerId &&
    guard !== null && guard.actionId === action.id && guard.outcome === 'pass' && nonblank(guard.reasoning) &&
    Array.isArray(guard.checksRun) && guard.checksRun.length > 0 && guard.checksRun.every(check =>
      isRecord(check) && nonblank(check.check) && nonblank(check.detail) && check.result === 'pass');
}

export function buildBatchPreviews(actions: ActionWithOwnedWebsiteAndGuard[]): BatchPreview[] {
  const counts = new Map<string, number>();
  for (const action of actions) counts.set(action.id, (counts.get(action.id) ?? 0) + 1);
  const groups = new Map<string, BatchPreview>();
  for (const action of actions) {
    if (counts.get(action.id) !== 1 || !eligible(action)) continue;
    const comparison = {
      customerId: action.customerId, clientProfileId: action.website.clientProfile.id,
      websiteId: action.websiteId, actionType: action.actionType, currentValue: action.currentValue,
      draftContent: action.draftContent, aiDisclosure: action.aiDisclosure, riskTier: action.riskTier,
      policyVersion: action.policyVersion,
      guard: { outcome: action.guardResult!.outcome, reasoning: action.guardResult!.reasoning,
        checksRun: action.guardResult!.checksRun },
    };
    const groupKey = createHash('sha256').update(canonical(comparison)).digest('hex');
    let group = groups.get(groupKey);
    if (!group) {
      group = { groupKey, websiteId: action.websiteId, clientProfileId: action.website.clientProfile.id,
        sharedCurrentValue: action.currentValue, sharedDraftContent: action.draftContent, items: [] };
      groups.set(groupKey, group);
    }
    if (group.items.length < 20) {
      group.items.push({ actionId: action.id, pageUrl: action.pageUrl, revision: actionRevision(action) });
    }
  }
  return [...groups.values()].filter(group => group.items.length >= 2);
}

export function parseBatchRequest(body: unknown): BatchRequest {
  const invalid = () => new BatchRequestError('Invalid batch request');
  let serialized: string | undefined;
  try { serialized = JSON.stringify(body); } catch { throw invalid(); }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 64 * 1024 || !isRecord(body) ||
    Object.keys(body).some(key => !['requestId', 'websiteId', 'decision', 'items'].includes(key)) ||
    typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId) ||
    !nonblank(body.websiteId) || (body.decision !== 'approve' && body.decision !== 'reject') ||
    !Array.isArray(body.items) || body.items.length < 2 || body.items.length > 20) throw invalid();

  const items: BatchRequest['items'] = [];
  const ids = new Set<string>();
  for (const item of body.items) {
    if (!isRecord(item) || Object.keys(item).some(key => !['actionId', 'revision'].includes(key)) ||
      !nonblank(item.actionId) || ids.has(item.actionId) || typeof item.revision !== 'string' ||
      !/^[0-9a-f]{64}$/.test(item.revision)) throw invalid();
    ids.add(item.actionId);
    items.push({ actionId: item.actionId, revision: item.revision });
  }
  return { requestId: body.requestId, websiteId: body.websiteId, decision: body.decision, items };
}

type BatchInput = { customerId: string; actorClerkUserId: string; request: BatchRequest };

function canonicalRequest(input: BatchInput) {
  return { ...input.request, actorClerkUserId: input.actorClerkUserId,
    items: [...input.request.items].sort((a, b) => a.actionId.localeCompare(b.actionId)) };
}

async function replay(tx: Pick<Prisma.TransactionClient, 'auditLogEntry'>, input: BatchInput): Promise<BatchResult | null> {
  const event = await tx.auditLogEntry.findFirst({ where: {
    customerId: input.customerId, eventType: 'action_batch_decided',
    detail: { path: ['requestId'], equals: input.request.requestId },
  } });
  if (!event) return null;
  const detail = event.detail;
  const result = isRecord(detail) ? detail.result : null;
  const expected = canonicalRequest(input);
  if (event.customerId !== input.customerId || event.eventType !== 'action_batch_decided' ||
      !isRecord(detail) || detail.requestId !== input.request.requestId ||
      canonical(detail.request) !== canonical(expected) || !isRecord(result) ||
      Object.keys(result).sort().join(',') !== 'actionIds,decision,requestId' ||
      result.requestId !== input.request.requestId || result.decision !== input.request.decision ||
      !Array.isArray(result.actionIds) || canonical(result.actionIds) !== canonical(expected.items.map(item => item.actionId))) {
    throw new ActionDecisionError(409, 'Request ID was already used for another batch or its saved result is invalid.');
  }
  return { requestId: result.requestId as string, decision: result.decision as BatchResult['decision'], actionIds: [...result.actionIds] as string[] };
}

async function ownedWebsite(tx: Pick<Prisma.TransactionClient, 'website'>, input: BatchInput) {
  const website = await tx.website.findUnique({ where: { id: input.request.websiteId },
    include: { clientProfile: { select: { id: true, customerId: true } } } });
  if (!website || website.clientProfileId !== website.clientProfile.id || website.clientProfile.customerId !== input.customerId) {
    throw new ActionDecisionError(404, 'Website not found');
  }
  return website;
}

async function batchActions(tx: Pick<Prisma.TransactionClient, 'action'>, input: BatchInput) {
  const actions = await tx.action.findMany({ where: { id: { in: input.request.items.map(item => item.actionId) } }, include: actionDecisionInclude });
  if (actions.length !== input.request.items.length || actions.some(action =>
    action.customerId !== input.customerId || action.websiteId !== input.request.websiteId ||
    action.website.id !== action.websiteId || action.website.clientProfileId !== action.website.clientProfile.id ||
    action.website.clientProfile.customerId !== input.customerId)) throw new ActionDecisionError(404, 'Action not found');
  const byId = new Map(actions.map(action => [action.id, action]));
  for (const item of input.request.items) {
    const action = byId.get(item.actionId);
    if (!action) throw new ActionDecisionError(404, 'Action not found');
    if (actionRevision(action) !== item.revision) throw new ActionDecisionError(409, 'Actions changed. Reload before deciding.');
  }
  const groups = buildBatchPreviews(actions);
  if (groups.length !== 1 || groups[0].items.length !== actions.length) {
    throw new ActionDecisionError(400, 'Actions are not eligible for one shared batch');
  }
  return [...actions].sort((a, b) => a.id.localeCompare(b.id));
}

export async function decideActionBatch(rawInput: BatchInput): Promise<BatchResult> {
  const input = { ...rawInput, request: parseBatchRequest(rawInput.request) };
  const website = await ownedWebsite(db, input);
  const saved = await replay(db, input);
  if (saved) return saved;
  const actions = await batchActions(db, input);
  const baselines = new Map<string, CapturedBaseline>();
  if (input.request.decision === 'approve' && website.gscRefreshToken && !website.gscReconnectRequired && website.gscPropertyUrl) {
    try {
      const rows = await listPagePerformance(decrypt(website.gscRefreshToken), website.gscPropertyUrl);
      const capturedAt = new Date();
      for (const action of actions) {
        const metrics = findObservedPagePerformance(rows, action.pageUrl);
        if (metrics) baselines.set(action.id, { metrics, capturedAt });
      }
    } catch {
      // Failed provider reads leave the baseline unavailable, not an invented zero.
    }
  }
  const committed = await db.$transaction(async tx => {
    await lockDecisionScope(tx, input.customerId, input.request.websiteId, input.request.items.map(item => item.actionId));
    await ownedWebsite(tx, input);
    const savedUnderLock = await replay(tx, input);
    if (savedUnderLock) return { result: savedUnderLock, actions: [] };
    const current = await batchActions(tx, input);
    for (const action of current) {
      await writeDecisionInTransaction(tx, { customerId: input.customerId, actorClerkUserId: input.actorClerkUserId,
        actionId: action.id, decision: input.request.decision }, action, baselines.get(action.id) ?? null, randomUUID());
    }
    const result: BatchResult = { requestId: input.request.requestId, decision: input.request.decision, actionIds: current.map(action => action.id) };
    await tx.auditLogEntry.create(buildAuditLogEntryArgs(input.customerId, 'action_batch_decided', {
      requestId: input.request.requestId, request: canonicalRequest(input), result,
    }));
    return { result, actions: current };
  });
  // Existing evaluation delivery is best effort; only the committing invocation attempts it.
  for (const action of committed.actions) {
    try {
      await recordEvaluationCase(action.websiteId, { actionId: action.id,
        decision: input.request.decision === 'approve' ? 'approved' : 'rejected', draftContent: action.draftContent });
    } catch (error) {
      console.error('action-batch: evaluation callback failed', error instanceof Error ? error.message : error);
    }
  }
  return committed.result;
}
