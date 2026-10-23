import { db } from './db';
import { isPreferenceActive } from './preference-activation';
import type { Prisma } from '@prisma/client';

export type InboxScope = { customerId: string; clientProfileId?: string; websiteId?: string };
export type InboxRow = {
  key: string; kind: 'action' | 'content' | 'preference'; id: string;
  clientProfileId: string; websiteId: string | null;
  scopeLabel: string; title: string; createdAt: string;
  state: 'needs_decision' | 'blocked_or_failed' | 'ready_to_apply' | 'history';
  href: string | null; unavailableReason: string | null;
};
export class InboxScopeNotFoundError extends Error {
  readonly status = 404;
  constructor() { super('Inbox scope not found'); }
}

const limit = 100;
const ownedInclude = { clientProfile: true } as const;
const actionInclude = {
  guardResult: true, website: { include: ownedInclude },
  provenanceRecords: { include: { findings: { include: { finding: true } } } },
} as const;
type OwnedSite = Prisma.WebsiteGetPayload<{ include: typeof ownedInclude }>;
type InboxAction = Prisma.ActionGetPayload<{ include: typeof actionInclude }>;

function siteMatches(site: OwnedSite, scope: InboxScope): boolean {
  return site.clientProfile.customerId === scope.customerId && site.clientProfileId === site.clientProfile.id &&
    (scope.clientProfileId === undefined || site.clientProfileId === scope.clientProfileId) &&
    (scope.websiteId === undefined || site.id === scope.websiteId);
}

function pendingState(action: InboxAction): Pick<InboxRow, 'state' | 'unavailableReason'> {
  if (action.generationStatus === 'failed') return { state: 'blocked_or_failed', unavailableReason: 'Generation failed' };
  const guard = action.guardResult;
  const validChecks = Array.isArray(guard?.checksRun) && guard.checksRun.length > 0 && guard.checksRun.every(check =>
    typeof check === 'object' && check !== null && !Array.isArray(check) && typeof check.check === 'string' &&
    typeof check.detail === 'string' && (check.result === 'pass' || check.result === 'fail'));
  if (!guard || !validChecks || !['pass', 'flag', 'block'].includes(guard.outcome) || typeof guard.reasoning !== 'string') {
    return { state: 'blocked_or_failed', unavailableReason: 'Proof check unavailable' };
  }
  if (guard.outcome === 'block') return { state: 'blocked_or_failed', unavailableReason: 'Proof check blocked' };
  return { state: 'needs_decision', unavailableReason: null };
}

// Verified-on-rescan (docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md): an
// action whose every causal finding was fixed/excluded by a later scan leaves the inbox --
// ActionStatus itself is never touched, so this is purely about what the inbox shows, not a
// human decision made on the owner's behalf. An action with no causal findings at all (e.g.
// findingAssociation !== 'causal' for every provenance record) is unaffected.
function allCausalFindingsResolved(action: InboxAction): boolean {
  const causalFindings = action.provenanceRecords.flatMap(pr => pr.findings.map(f => f.finding));
  return causalFindings.length > 0 && causalFindings.every(f => f.resolution === 'fixed' || f.resolution === 'excluded');
}

export async function loadDecisionInbox(scope: InboxScope): Promise<{ rows: InboxRow[]; truncated: boolean; truncatedSections: string[] }> {
  if (scope.clientProfileId !== undefined) {
    const profile = await db.clientProfile.findFirst({ where: { id: scope.clientProfileId, customerId: scope.customerId } });
    if (!profile) throw new InboxScopeNotFoundError();
  }
  if (scope.websiteId !== undefined) {
    const website = await db.website.findFirst({
      where: { id: scope.websiteId, clientProfile: { customerId: scope.customerId } }, include: ownedInclude,
    });
    if (!website || !siteMatches(website, scope)) throw new InboxScopeNotFoundError();
  }
  const websiteWhere: Prisma.WebsiteWhereInput = {
    clientProfile: { customerId: scope.customerId },
    ...(scope.clientProfileId !== undefined ? { clientProfileId: scope.clientProfileId } : {}),
    ...(scope.websiteId !== undefined ? { id: scope.websiteId } : {}),
  };
  const profileWhere: Prisma.ClientProfileWhereInput = {
    customerId: scope.customerId,
    ...(scope.clientProfileId !== undefined ? { id: scope.clientProfileId } : {}),
  };
  const rows: InboxRow[] = [];
  const truncatedSections: string[] = [];
  function bounded<T>(values: T[], section: string): T[] {
    if (values.length > limit) truncatedSections.push(section);
    return values.slice(0, limit);
  }

  for (const status of ['pending', 'approved', 'edited', 'rejected'] as const) {
    const actions = await db.action.findMany({
      where: { customerId: scope.customerId, website: websiteWhere, status }, include: actionInclude,
      take: limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    for (const action of bounded(actions, `actions ${status}`)) {
      if (action.customerId !== scope.customerId || action.websiteId !== action.website.id || !siteMatches(action.website, scope)) continue;
      if (status === 'pending' && allCausalFindingsResolved(action)) continue;
      const state = status === 'pending' ? pendingState(action) : {
        state: status === 'rejected' ? 'history' as const : 'ready_to_apply' as const, unavailableReason: null,
      };
      rows.push({ key: `action:${action.id}`, kind: 'action', id: action.id,
        clientProfileId: action.website.clientProfileId, websiteId: action.websiteId,
        scopeLabel: `${action.website.clientProfile.name}: ${action.website.url}`, title: action.pageUrl,
        createdAt: action.createdAt.toISOString(), href: `/review/${encodeURIComponent(action.id)}`, ...state });
    }
  }

  for (const status of ['needs_review', 'failed'] as const) {
    const pieces = await db.contentPiece.findMany({
      where: { clientProfile: profileWhere, status,
        ...(scope.websiteId !== undefined ? { sourceAction: { customerId: scope.customerId, websiteId: scope.websiteId } } : {}),
      },
      include: { clientProfile: true, sourceAction: { include: { website: { include: ownedInclude } } } },
      take: limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    for (const piece of bounded(pieces, `content ${status}`)) {
      if (piece.clientProfile.customerId !== scope.customerId || piece.clientProfileId !== piece.clientProfile.id ||
          (scope.clientProfileId !== undefined && piece.clientProfileId !== scope.clientProfileId)) continue;
      const source = piece.sourceAction;
      if (piece.sourceActionId !== null && (!source || source.id !== piece.sourceActionId || source.customerId !== scope.customerId ||
          source.websiteId !== source.website.id || source.website.clientProfileId !== piece.clientProfileId || !siteMatches(source.website, scope))) continue;
      if (scope.websiteId !== undefined && !source) continue;
      const href = piece.clientProfile.isDefault ? `/studio${source ? `?websiteId=${encodeURIComponent(source.websiteId)}` : ''}` : null;
      rows.push({ key: `content:${piece.id}`, kind: 'content', id: piece.id, clientProfileId: piece.clientProfileId,
        websiteId: source?.websiteId ?? null, scopeLabel: source ? `${piece.clientProfile.name}: ${source.website.url}` : 'Client-wide; no website link',
        title: piece.topic, createdAt: piece.createdAt.toISOString(), state: status === 'failed' ? 'blocked_or_failed' : 'needs_decision',
        href, unavailableReason: !href ? 'Direct client navigation in Content Studio is unavailable' : status === 'failed' ? 'Content generation failed' : null });
    }
  }

  const preferenceWhere = { clientProfile: profileWhere, website: websiteWhere };
  const candidates = await db.preferenceCandidate.findMany({
    where: { ...preferenceWhere, status: 'proposed' }, include: { clientProfile: true, website: { include: ownedInclude } },
    take: limit + 1, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
  });
  const evaluations = await db.preferenceEvaluation.findMany({
    where: { ...preferenceWhere, status: 'passed' },
    include: { clientProfile: true, website: { include: ownedInclude }, candidate: true },
    take: limit + 1, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
  const preferences = new Map<string, InboxRow>();
  for (const candidate of bounded(candidates, 'proposed preferences')) {
    if (!siteMatches(candidate.website, scope) || candidate.websiteId !== candidate.website.id ||
        candidate.clientProfileId !== candidate.website.clientProfileId || candidate.clientProfile.id !== candidate.clientProfileId ||
        candidate.clientProfile.customerId !== scope.customerId) continue;
    preferences.set(candidate.id, { key: `preference:${candidate.id}`, kind: 'preference', id: candidate.id,
      clientProfileId: candidate.clientProfileId, websiteId: candidate.websiteId,
      scopeLabel: `Whole client profile: ${candidate.clientProfile.name}; origin ${candidate.website.url}`,
      title: `Evaluate preference: ${candidate.originalProposedPhrase}`, createdAt: candidate.generatedAt.toISOString(),
      state: 'needs_decision', href: `#preference-${encodeURIComponent(candidate.id)}`, unavailableReason: null });
  }
  for (const evaluation of bounded(evaluations, 'passed preference evaluations')) {
    if (!siteMatches(evaluation.website, scope) || evaluation.websiteId !== evaluation.website.id ||
        evaluation.clientProfileId !== evaluation.website.clientProfileId || evaluation.clientProfile.id !== evaluation.clientProfileId ||
        evaluation.clientProfile.customerId !== scope.customerId || evaluation.candidateId !== evaluation.candidate.id ||
        evaluation.candidate.clientProfileId !== evaluation.clientProfileId || evaluation.candidate.websiteId !== evaluation.websiteId) continue;
    if (isPreferenceActive(evaluation.clientProfile.restrictedWording, evaluation.evaluatedPhrase)) {
      preferences.delete(evaluation.candidateId);
      continue;
    }
    preferences.set(evaluation.candidateId, { key: `preference:${evaluation.candidateId}`, kind: 'preference', id: evaluation.candidateId,
      clientProfileId: evaluation.clientProfileId, websiteId: evaluation.websiteId,
      scopeLabel: `Whole client profile: ${evaluation.clientProfile.name}; origin ${evaluation.website.url}`,
      title: `Activate preference: ${evaluation.evaluatedPhrase}`, createdAt: evaluation.startedAt.toISOString(),
      state: 'needs_decision', href: `#preference-${encodeURIComponent(evaluation.candidateId)}`, unavailableReason: null });
  }
  rows.push(...preferences.values());
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.key.localeCompare(a.key));
  return { rows, truncated: truncatedSections.length > 0, truncatedSections };
}
