import React from 'react';
import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { loadDecisionInbox, type InboxRow } from '@/lib/decision-inbox';
import { Card, CardContent } from '@/components/ui/card';
import { ReviewQueueList } from '@/components/dashboard/review-queue-list';
import { ActionDetail } from '@/components/review/action-detail';
import { PreferenceSuggestionCard } from '@/components/review/preference-suggestion-card';
import { ActivationToggle } from '@/components/settings/activation-toggle';
import { buildTypeFilterOptions, resolveTypeFilter } from '@/lib/review-queue-filter';
import { actionRevision } from '@/lib/proof-receipt';
import { loadProofReceipt } from '@/lib/load-proof-receipt';
import { isPreferenceActive } from '@/lib/preference-activation';
import { buildBatchPreviews } from '@/lib/action-batch';
import { BatchDecisionPanel } from '@/components/review/batch-decision-panel';

const sectionLabels = { needs_decision: 'Needs decision', blocked_or_failed: 'Blocked or failed', ready_to_apply: 'Ready to apply', history: 'Decision history' } as const;
const linkClass = 'inline-flex min-h-11 items-center rounded-md px-3 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default async function ReviewQueuePage({ searchParams }: {
  searchParams: { actionId?: string; type?: string | string[]; clientProfileId?: string; websiteId?: string };
}) {
  const { userId } = auth();
  if (!userId) return null;
  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return null;
  const scope = { customerId: customer.id, clientProfileId: searchParams.clientProfileId, websiteId: searchParams.websiteId };
  let inbox;
  try { inbox = await loadDecisionInbox(scope); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) return notFound();
    throw error;
  }
  const websiteWhere = { clientProfile: { customerId: customer.id },
    ...(scope.clientProfileId !== undefined ? { clientProfileId: scope.clientProfileId } : {}) };
  const actionWhere = { customerId: customer.id, website: websiteWhere,
    ...(scope.websiteId !== undefined ? { websiteId: scope.websiteId } : {}) };
  const include = { guardResult: true, website: { include: { clientProfile: { select: { id: true, customerId: true } } } } } as const;
  const actionIds = inbox.rows.filter(row => row.kind === 'action' && (row.state === 'needs_decision' || row.state === 'blocked_or_failed')).map(row => row.id);
  const pendingActions = actionIds.length ? await db.action.findMany({
    where: { ...actionWhere, id: { in: actionIds }, status: 'pending' }, include,
    take: 100, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  }) : [];
  const linkedAction = searchParams.actionId ? await db.action.findFirst({ where: { ...actionWhere, id: searchParams.actionId }, include }) : null;
  if (searchParams.actionId && !linkedAction) return notFound();
  const typeOptions = buildTypeFilterOptions(pendingActions);
  const activeType = resolveTypeFilter(searchParams.type, typeOptions);
  const visibleActions = activeType ? pendingActions.filter(action => action.actionType === activeType) : pendingActions;
  const queueActions = visibleActions.map(action => ({ ...action, revision: actionRevision(action) }));
  const batches = buildBatchPreviews(visibleActions);
  const selected = linkedAction ?? visibleActions[0] ?? null;
  const receipt = selected ? await loadProofReceipt(selected, customer.id) : undefined;
  const preferenceIds = inbox.rows.filter(row => row.kind === 'preference').map(row => row.id);
  const candidates = preferenceIds.length ? await db.preferenceCandidate.findMany({
    where: { id: { in: preferenceIds }, clientProfile: { customerId: customer.id }, website: websiteWhere,
      ...(scope.clientProfileId !== undefined ? { clientProfileId: scope.clientProfileId } : {}),
      ...(scope.websiteId !== undefined ? { websiteId: scope.websiteId } : {}) },
    include: { clientProfile: true, website: true, evaluation: true }, take: 200,
  }) : [];
  function typeHref(type?: string) {
    const params = new URLSearchParams();
    if (scope.clientProfileId !== undefined) params.set('clientProfileId', scope.clientProfileId);
    if (scope.websiteId !== undefined) params.set('websiteId', scope.websiteId);
    if (type) params.set('type', type);
    return '/review' + (params.size ? '?' + params : '');
  }
  // Dashboard audit item 11: a site-change row in a state the "Site changes" section below
  // already renders with its own full review UI (approve/reject, filters, batches) doesn't
  // also need the plain generic link row the inbox sections below render for everything else --
  // that was the literal duplicate. Content/preference rows in these same states aren't shown
  // anywhere else, so they stay. Decided states (ready_to_apply/history) have no such overlap.
  const DUPLICATED_IN_SITE_CHANGES = new Set(['needs_decision', 'blocked_or_failed']);
  const awaitingDecisionCount = inbox.rows.filter(row => DUPLICATED_IN_SITE_CHANGES.has(row.state)).length;
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Review</h1>
      <p className="mt-1 text-sm text-muted-foreground">{awaitingDecisionCount} changes waiting for your decision. Approval does not publish. Apply approved changes yourself.</p>
      {inbox.truncated && <div className="mt-4 rounded-md border border-border p-3 text-sm text-muted-foreground">
        {(inbox.truncatedSections ?? ['inbox entries']).map(section => <p key={section}>Showing first 100 {section}. Counts refer to loaded entries.</p>)}
      </div>}
      {inbox.rows.length === 0 && <p className="mt-6 text-sm text-muted-foreground">Nothing to review in this scope.</p>}
      {Object.entries(sectionLabels).map(([state, label]) => {
        const rows = inbox.rows.filter(row =>
          row.state === state && !(DUPLICATED_IN_SITE_CHANGES.has(state) && row.kind === 'action')
        );
        if (!rows.length) return null;
        return <section key={state} className="mt-8" aria-label={label}>
          <h2 className="text-lg font-semibold text-foreground">{label} <span className="text-sm font-normal text-muted-foreground">({rows.length} loaded)</span></h2>
          {state === 'ready_to_apply' && <p className="mt-1 text-sm text-muted-foreground">Copy approved or edited changes into your site. Content export stays in Studio.</p>}
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {rows.map(row => <li key={row.key} className="min-w-0 p-4">
              <p className="text-xs text-muted-foreground">{row.kind === 'action' ? 'Site change' : row.kind === 'content' ? 'Content draft' : 'Preference'} · {row.scopeLabel}</p>
              {row.href ? <Link className={linkClass + ' max-w-full break-all px-0 text-foreground'} href={row.href}>{row.title}</Link> : <p className="mt-2 break-words text-sm text-foreground">{row.title}</p>}
              {row.unavailableReason && <p className="mt-1 text-sm text-muted-foreground">{row.unavailableReason}</p>}
            </li>)}
          </ul>
        </section>;
      })}
      {candidates.map(candidate => {
        const evaluation = candidate.evaluation;
        const passed = evaluation?.status === 'passed';
        if ((passed && isPreferenceActive(candidate.clientProfile.restrictedWording, evaluation.evaluatedPhrase)) || candidate.clientProfileId !== candidate.website.clientProfileId) return null;
        const excerpts = Array.isArray(candidate.evidenceExcerpts) ? candidate.evidenceExcerpts.filter((value): value is { auditLogEntryId: string; before: string; after: string } =>
          typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.auditLogEntryId === 'string' && typeof value.before === 'string' && typeof value.after === 'string') : [];
        return <section key={candidate.id} id={'preference-' + candidate.id} className="mt-6" aria-label="Preference decision">
          <p className="mb-3 text-sm text-muted-foreground">This preference affects the whole client profile: {candidate.clientProfile.name}. Origin: {candidate.website.url}.</p>
          {passed ? <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border p-4">
            <p className="break-words text-sm text-foreground">{evaluation.evaluatedPhrase}</p>
            <ActivationToggle candidateId={candidate.id} initialActive={false} />
          </div> : candidate.status === 'proposed' ? <PreferenceSuggestionCard checkWebsiteIds={[]} initialCandidate={{
            id: candidate.id, originalProposedPhrase: candidate.originalProposedPhrase, rationale: candidate.rationale, evidenceExcerpts: excerpts, websiteUrl: candidate.website.url,
          }} /> : null}
        </section>;
      })}
      {(pendingActions.length > 0 || selected) && <section className="mt-8" aria-label="Site change detail">
        <h2 className="text-lg font-semibold text-foreground">Site changes</h2>
        {typeOptions.length > 1 && <nav aria-label="Filter by fix type" className="mt-3 flex flex-wrap gap-2">
          <Link className={linkClass} href={typeHref()} aria-current={!activeType ? 'page' : undefined}>All loaded site changes</Link>
          {typeOptions.map(option => <Link key={option.actionType} className={linkClass} href={typeHref(option.actionType)} aria-current={activeType === option.actionType ? 'page' : undefined}>{option.label} ({option.count})</Link>)}
        </nav>}
        {batches.map(batch => {
          const source = visibleActions.find(action => action.id === batch.items[0].actionId)!;
          const guard = source.guardResult!;
          return <BatchDecisionPanel key={batch.groupKey + batch.items.map(item => item.revision).join(':')} preview={{
            ...batch, policyVersion: source.policyVersion, aiDisclosure: source.aiDisclosure, reasoning: guard.reasoning,
            checks: guard.checksRun as { check: string; detail: string; result: string }[],
          }} />;
        })}
        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:hidden"><ReviewQueueList actions={queueActions} selectedActionId={selected?.id ?? null} hrefBase="/review" /></div>
          <div className="hidden md:col-span-5 md:block"><ReviewQueueList actions={queueActions} selectedActionId={selected?.id ?? null} /></div>
          {selected && <div className="hidden md:sticky md:top-6 md:col-span-7 md:block md:self-start">
            <Card><CardContent className="pt-6"><ActionDetail action={{ ...selected, guardResult: Array.isArray(selected.guardResult?.checksRun) ? selected.guardResult : null }} revision={actionRevision(selected)} receipt={receipt} /></CardContent></Card>
          </div>}
        </div>
      </section>}
    </main>
  );
}
