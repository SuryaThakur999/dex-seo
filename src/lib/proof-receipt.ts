import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ProofCheckResult } from './proof-layer';

export type ActionWithGuard = Prisma.ActionGetPayload<{ include: { guardResult: true } }>;
export type ActionWithOwnedWebsiteAndGuard = Prisma.ActionGetPayload<{
  include: {
    guardResult: true;
    website: { include: { clientProfile: { select: { id: true; customerId: true } } } };
  };
}>;

export type ReceiptSnapshotV1 = {
  version: 1;
  actionId: string;
  customerId: string;
  clientProfileId: string;
  websiteId: string;
  pageUrl: string;
  actionType: string;
  currentValue: string | null;
  preDecisionDraftContent: string;
  decidedContent: string;
  decision: 'approved' | 'edited' | 'rejected';
  actorClerkUserId: string;
  decidedAt: string;
  riskTier: string;
  policyVersion: string;
  guard: { outcome: string; reasoning: string; checksRun: ProofCheckResult[] } | null;
  checkedContent: 'unavailable';
  provenance: { status: 'unavailable' };
};

export type ReceiptEvent = {
  id: string;
  customerId: string;
  actionId: string | null;
  eventType: string;
  createdAt: string;
  detail: unknown;
};

export type ReceiptView = {
  actionId: string;
  snapshot: ReceiptSnapshotV1 | null;
  currentRecord: {
    pageUrl: string;
    actionType: string;
    currentValue: string | null;
    draftContent: string;
    riskTier: string;
    policyVersion: string;
    guard: ReceiptSnapshotV1['guard'];
  };
  basis: 'saved_snapshot' | 'current_record';
  events: ReceiptEvent[];
  limitations: string[];
  outcome: {
    baseline: unknown;
    baselineCapturedAt: string | null;
    measured: unknown;
    measuredAt: string | null;
    availability: 'observed_rows' | 'historical_unqualified' | 'unavailable';
  };
};

type Decision = ReceiptSnapshotV1['decision'];
const decisionValues = new Set<Decision>(['approved', 'edited', 'rejected']);
const guardOutcomes = new Set(['pass', 'flag', 'block']);
const mismatchLimitation = 'Saved receipt does not match its decision record';
const historicalMetricsLimitation = 'Historical GSC values; row availability was not recorded';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isIsoDate(value: unknown): value is string {
  if (!isString(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parseChecks(value: unknown): ProofCheckResult[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const checks: ProofCheckResult[] = [];
  for (const check of value) {
    if (!isRecord(check) || !isString(check.check) || !isString(check.detail) || (check.result !== 'pass' && check.result !== 'fail')) return null;
    checks.push({ check: check.check, result: check.result, detail: check.detail });
  }
  return checks;
}

function parseGuard(value: unknown): ReceiptSnapshotV1['guard'] {
  if (value === null) return null;
  if (!isRecord(value) || !isString(value.outcome) || !guardOutcomes.has(value.outcome) || !isString(value.reasoning)) return null;
  const checksRun = parseChecks(value.checksRun);
  return checksRun ? { outcome: value.outcome, reasoning: value.reasoning, checksRun } : null;
}

function parseSnapshot(value: unknown): ReceiptSnapshotV1 | null {
  if (!isRecord(value) || value.version !== 1 || !isString(value.actionId) || !value.actionId ||
      !isString(value.customerId) || !value.customerId || !isString(value.clientProfileId) || !value.clientProfileId ||
      !isString(value.websiteId) || !value.websiteId || !isString(value.pageUrl) || !isString(value.actionType) ||
      !(value.currentValue === null || isString(value.currentValue)) || !isString(value.preDecisionDraftContent) ||
      !isString(value.decidedContent) || !decisionValues.has(value.decision as Decision) || !isString(value.actorClerkUserId) ||
      !value.actorClerkUserId || !isIsoDate(value.decidedAt) || !isString(value.riskTier) || !isString(value.policyVersion) ||
      value.checkedContent !== 'unavailable' || !isRecord(value.provenance) || value.provenance.status !== 'unavailable') return null;

  return {
    version: 1,
    actionId: value.actionId,
    customerId: value.customerId,
    clientProfileId: value.clientProfileId,
    websiteId: value.websiteId,
    pageUrl: value.pageUrl,
    actionType: value.actionType,
    currentValue: value.currentValue,
    preDecisionDraftContent: value.preDecisionDraftContent,
    decidedContent: value.decidedContent,
    decision: value.decision as Decision,
    actorClerkUserId: value.actorClerkUserId,
    decidedAt: value.decidedAt,
    riskTier: value.riskTier,
    policyVersion: value.policyVersion,
    guard: parseGuard(value.guard),
    checkedContent: 'unavailable',
    provenance: { status: 'unavailable' },
  };
}

function eventDetail(event: ReceiptEvent): Record<string, unknown> | null {
  return isRecord(event.detail) ? event.detail : null;
}

function boundSnapshot(action: ActionWithOwnedWebsiteAndGuard, event: ReceiptEvent): ReceiptSnapshotV1 | null {
  const detail = eventDetail(event);
  if (!detail || action.website.id !== action.websiteId || action.website.clientProfileId !== action.website.clientProfile.id ||
      event.eventType !== 'action_decided' || event.actionId !== action.id ||
      event.customerId !== action.customerId || event.customerId !== action.website.clientProfile.customerId ||
      !isIsoDate(event.createdAt)) return null;
  const snapshot = parseSnapshot(detail.receiptSnapshot);
  if (!snapshot || snapshot.actionId !== action.id || snapshot.customerId !== action.customerId ||
      snapshot.clientProfileId !== action.website.clientProfile.id || snapshot.websiteId !== action.websiteId ||
      snapshot.pageUrl !== action.pageUrl || snapshot.actionType !== action.actionType ||
      snapshot.decision !== detail.decision || snapshot.actorClerkUserId !== detail.actorClerkUserId ||
      snapshot.decidedAt !== event.createdAt) return null;
  return snapshot;
}

function isMetric(value: unknown): value is { impressions: number; clicks: number; ctr: number } {
  if (!isRecord(value)) return false;
  const { impressions, clicks, ctr } = value;
  return typeof impressions === 'number' && Number.isFinite(impressions) && impressions >= 0 &&
    typeof clicks === 'number' && Number.isFinite(clicks) && clicks >= 0 && clicks <= impressions &&
    typeof ctr === 'number' && Number.isFinite(ctr) && ctr >= 0 && ctr <= 1 && (impressions > 0 || ctr === 0);
}

function hasObservedTag(value: unknown, decisionEventId: string): value is Record<string, unknown> {
  return isRecord(value) && value.captureVersion === 1 && value.availability === 'observed_gsc_row' &&
    value.decisionEventId === decisionEventId && isMetric(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function actionRevision(action: ActionWithOwnedWebsiteAndGuard): string {
  const comparison = {
    customerId: action.customerId,
    websiteCustomerId: action.website.clientProfile.customerId,
    clientProfileId: action.website.clientProfile.id,
    websiteId: action.websiteId,
    actionType: action.actionType,
    currentValue: action.currentValue,
    draftContent: action.draftContent,
    aiDisclosure: action.aiDisclosure,
    riskTier: action.riskTier,
    policyVersion: action.policyVersion,
    guard: action.guardResult ? {
      outcome: action.guardResult.outcome,
      reasoning: action.guardResult.reasoning,
      checksRun: action.guardResult.checksRun,
    } : null,
    id: action.id,
    pageUrl: action.pageUrl,
    status: action.status,
    generationStatus: action.generationStatus,
    generationError: action.generationError,
    createdAt: action.createdAt.toISOString(),
    decidedAt: action.decidedAt?.toISOString() ?? null,
  };
  return createHash('sha256').update(canonical(comparison)).digest('hex');
}

export function buildReceiptSnapshot(input: {
  action: ActionWithOwnedWebsiteAndGuard;
  decision: Decision;
  decidedContent: string;
  actorClerkUserId: string;
  decidedAt: Date;
}): ReceiptSnapshotV1 {
  const { action, decision, decidedContent, actorClerkUserId, decidedAt } = input;
  const parsedGuard = action.guardResult ? parseGuard({
    outcome: action.guardResult.outcome,
    reasoning: action.guardResult.reasoning,
    checksRun: action.guardResult.checksRun,
  }) : null;
  return {
    version: 1,
    actionId: action.id,
    customerId: action.customerId,
    clientProfileId: action.website.clientProfile.id,
    websiteId: action.websiteId,
    pageUrl: action.pageUrl,
    actionType: action.actionType,
    currentValue: action.currentValue,
    preDecisionDraftContent: action.draftContent,
    decidedContent,
    decision,
    actorClerkUserId,
    decidedAt: decidedAt.toISOString(),
    riskTier: action.riskTier,
    policyVersion: action.policyVersion,
    guard: parsedGuard,
    checkedContent: 'unavailable',
    provenance: { status: 'unavailable' },
  };
}

export function buildProofReceipt(input: { action: ActionWithOwnedWebsiteAndGuard; events: ReceiptEvent[] }): ReceiptView {
  const { action, events } = input;
  const orderedEvents = [...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const limitations: string[] = [];
  const validSnapshots = orderedEvents.flatMap((entry) => {
    if (entry.eventType !== 'action_decided') return [];
    const detail = eventDetail(entry);
    if (!detail || !Object.prototype.hasOwnProperty.call(detail, 'receiptSnapshot')) return [];
    const snapshot = boundSnapshot(action, entry);
    if (snapshot) return [{ event: entry, snapshot }];
    limitations.push(mismatchLimitation);
    return [];
  });
  const latest = validSnapshots.at(-1) ?? null;
  const currentDecision = action.status !== 'pending' && action.decidedAt
    ? validSnapshots.find(({ event, snapshot }) => snapshot.decision === action.status && snapshot.decidedAt === action.decidedAt?.toISOString() && event.createdAt === action.decidedAt?.toISOString()) ?? null
    : null;

  const baseline = action.baselinePerformance;
  const measured = action.outcomePerformance;
  const hasAnyMetrics = baseline !== null || measured !== null;
  let availability: ReceiptView['outcome']['availability'] = 'unavailable';
  if (currentDecision && hasObservedTag(baseline, currentDecision.event.id) && hasObservedTag(measured, currentDecision.event.id) &&
      isIsoDate(action.baselineCapturedAt?.toISOString()) && isIsoDate(action.outcomeMeasuredAt?.toISOString())) {
    availability = 'observed_rows';
  } else if (isMetric(baseline) && isMetric(measured) && isRecord(baseline) && isRecord(measured) &&
      !('captureVersion' in baseline) && !('captureVersion' in measured)) {
    availability = 'historical_unqualified';
    limitations.push(historicalMetricsLimitation);
  }

  const currentGuard = action.guardResult ? parseGuard({ outcome: action.guardResult.outcome, reasoning: action.guardResult.reasoning, checksRun: action.guardResult.checksRun }) : null;
  return {
    actionId: action.id,
    snapshot: latest?.snapshot ?? null,
    currentRecord: {
      pageUrl: action.pageUrl,
      actionType: action.actionType,
      currentValue: action.currentValue,
      draftContent: action.draftContent,
      riskTier: action.riskTier,
      policyVersion: action.policyVersion,
      guard: currentGuard,
    },
    basis: latest ? 'saved_snapshot' : 'current_record',
    events: orderedEvents.filter((entry) => entry.customerId === action.customerId && entry.actionId === action.id),
    limitations: [...new Set(limitations)],
    outcome: {
      baseline,
      baselineCapturedAt: action.baselineCapturedAt?.toISOString() ?? null,
      measured,
      measuredAt: action.outcomeMeasuredAt?.toISOString() ?? null,
      availability,
    },
  };
}
