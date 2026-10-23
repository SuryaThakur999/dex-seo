import React, { Fragment } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  type OpportunityGroup,
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_PROOFLAYER_LABEL,
} from '@/lib/opportunity-board';
import { suggestChannelsForAction } from '@/lib/content-studio/suggest-channels';

const STATUS_VARIANT: Record<OpportunityGroup['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  found: 'outline',
  draft_ready: 'secondary',
  needs_review: 'secondary',
  failed: 'destructive',
};

const PROOFLAYER_VARIANT: Record<'passed' | 'needs_review' | 'blocked', 'default' | 'secondary' | 'destructive'> = {
  passed: 'default',
  needs_review: 'secondary',
  blocked: 'destructive',
};

const BOARD_LIMIT = 8;

type OpportunityRowContext = {
  websiteId: string;
  group: OpportunityGroup;
  soleFindingId: string | undefined;
  suggestions: ReturnType<typeof suggestChannelsForAction>;
};

// Shared between the desktop table's action column and the mobile stacked card (dashboard
// audit item 9) -- same links, same conditions, rendered in two different containers.
function renderOpportunityAction({ websiteId, group, soleFindingId, suggestions }: OpportunityRowContext) {
  const recommendation = group.recommendation;
  if (recommendation) {
    return (
      <Link
        href={`/studio?websiteId=${websiteId}&topic=${encodeURIComponent(recommendation.angle || group.issueLabel)}&sourceRecommendationId=${recommendation.id}`}
        className="rounded-md border border-input px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
      >
        Create draft
      </Link>
    );
  }
  if (group.noAutoFixReason) {
    return (
      <span className="text-xs text-muted-foreground" title={group.noAutoFixReason}>
        No automatic fix. See why.
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestions.map((s) => (
        <Link
          key={s.platform}
          href={`/studio?websiteId=${websiteId}&platform=${s.platform}&topic=${encodeURIComponent(
            `Write content addressing "${group.issueLabel}" on ${group.samplePageUrl}.`
          )}${soleFindingId ? `&sourceFindingId=${soleFindingId}` : ''}`}
          title={s.rationale}
          className="text-xs font-medium text-accent underline-offset-4 hover:underline"
        >
          Studio
        </Link>
      ))}
      <Link
        href="/review"
        className="rounded-md border border-input px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
      >
        Review
      </Link>
    </div>
  );
}

// Shared between the desktop table's contributors disclosure row and the mobile stacked card.
function renderContributorsDisclosure(group: OpportunityGroup, isConsolidated: boolean) {
  return (
    <details className="rounded-md bg-muted/40 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        {isConsolidated
          ? `Combined by the orchestrator — ${group.contributors!.length} contributing findings`
          : `${group.contributors!.length} contributing finding${group.contributors!.length === 1 ? '' : 's'}`}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {group.noAutoFixReason && (
          <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
            <span className="font-medium">Why there&apos;s no auto-fix: </span>
            {group.noAutoFixReason}
          </p>
        )}
        {isConsolidated && <p className="text-xs text-muted-foreground">{group.consolidationReason}</p>}
        {group.decisionRecord && (
          <div className="rounded border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
            <p>Resolution: {group.decisionRecord.resolutionRule}</p>
            <p>Agreement: {group.decisionRecord.agreement}</p>
            <p>Final recommendation: {group.decisionRecord.finalRecommendation}</p>
            <p>Measurement: {group.decisionRecord.measurementPlan}</p>
          </div>
        )}
        {group.contributors!.map((c, i) => (
          <div key={i} className="rounded border border-border bg-background px-2 py-1.5 text-xs">
            <p className="font-medium text-foreground">
              {c.agent} · {c.ruleId}
            </p>
            <p className="mt-0.5 text-muted-foreground">{c.pageUrl}</p>
            <p className="mt-0.5 text-muted-foreground">{c.suggestedAction}</p>
            {c.limitations && <p className="mt-0.5 italic text-muted-foreground">{c.limitations}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

// Shared between the desktop table's evidence disclosure row and the mobile stacked card.
function renderEvidenceDisclosure(recommendation: NonNullable<OpportunityGroup['recommendation']>) {
  return (
    <details className="rounded-md bg-muted/40 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Evidence and reasoning
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
          <span className="font-medium">Why now: </span>
          {recommendation.whyNow}
        </p>
        <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
          <span className="font-medium">Why it fits: </span>
          {recommendation.businessRelevance}
        </p>
        <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
          <span className="font-medium">Angle: </span>
          {recommendation.angle}
        </p>
      </div>
    </details>
  );
}

// Mobile stacked card (dashboard audit item 9): the table's `min-w-[480px]` clipped the
// ProofLayer and Action columns below md. Same data and links as the table row, reused via the
// render* helpers above instead of a second hand-written copy.
function MobileOpportunityCard({ group, websiteId }: { group: OpportunityGroup; websiteId: string }) {
  const ruleId = group.key.startsWith('finding:') ? group.key.slice('finding:'.length) : null;
  const suggestions = ruleId ? suggestChannelsForAction(ruleId) : [];
  const isConsolidated = Boolean(group.consolidationReason);
  const soleFindingId = ruleId && group.contributors?.length === 1 ? group.contributors[0].id : undefined;

  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <p className="font-medium text-foreground">
        {group.issueLabel}
        {isConsolidated && (
          <Badge variant="outline" className="ml-2 align-middle text-[10px]">
            Combined
          </Badge>
        )}
      </p>
      {group.technicalLabel && <p className="text-xs text-muted-foreground">{group.technicalLabel}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{group.pageCount} page{group.pageCount === 1 ? '' : 's'}</span>
        <Badge variant={STATUS_VARIANT[group.status]}>{OPPORTUNITY_STATUS_LABEL[group.status]}</Badge>
        {group.proofLayer ? (
          <Badge variant={PROOFLAYER_VARIANT[group.proofLayer]}>{OPPORTUNITY_PROOFLAYER_LABEL[group.proofLayer]}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">ProofLayer: —</span>
        )}
      </div>
      <div className="mt-3">
        {renderOpportunityAction({ websiteId, group, soleFindingId, suggestions })}
      </div>
      {group.contributors && group.contributors.length > 0 && (
        <div className="mt-2">{renderContributorsDisclosure(group, isConsolidated)}</div>
      )}
      {group.recommendation && (
        <div className="mt-2">{renderEvidenceDisclosure(group.recommendation)}</div>
      )}
    </div>
  );
}

// DEX CONTINUATION MASTER DIRECTIVE Phase 2: one evidence-backed Opportunity Board,
// replacing the separate "Needs your attention" / "Website findings" lists. Locale column
// intentionally omitted — no real per-website language/market field exists yet (Phase 6).
export function OpportunityBoard({ groups, websiteId }: { groups: OpportunityGroup[]; websiteId: string }) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Top opportunities</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No opportunities from the latest scan.</p>
        </CardContent>
      </Card>
    );
  }

  const top = groups.slice(0, BOARD_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base font-medium">Top opportunities</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Prioritized fixes to improve your site&apos;s visibility in search and AI answer engines.
          </p>
        </div>
        <Link href="/review" className="shrink-0 text-sm font-medium text-accent underline-offset-4 hover:underline">
          View all in Review &rarr;
        </Link>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-0">
        {/* Desktop table kept as CardContent's literal first child (not wrapped in a
            responsive-visibility <div>) so opportunity-board.test.tsx's structural element-tree
            traversal (cardContent.props.children[0] === table) keeps working unchanged; the
            hidden/md:table classes do the responsive hiding directly on the table itself. Its
            action/disclosure cells intentionally keep their own inline JSX rather than calling
            the render* helpers below, for the same reason -- this table's exact tree shape is
            asserted on by several existing tests. */}
        <table className="hidden w-full min-w-[480px] text-sm md:table">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">Issue</th>
              <th className="py-2 pr-4">Pages</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">ProofLayer</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {top.map((group) => {
              const ruleId = group.key.startsWith('finding:') ? group.key.slice('finding:'.length) : null;
              const suggestions = ruleId ? suggestChannelsForAction(ruleId) : [];
              const isConsolidated = Boolean(group.consolidationReason);
              // Phase 2F S3: a one-click draft may carry real evidence only when this
              // opportunity resolves to exactly one persisted Finding — a multi-page group
              // has no single source to attach, so it falls back to the topic-only link.
              // (A consolidated group never reaches here with a Studio link at all: its key
              // never starts with "finding:", so ruleId/suggestions above are already empty.)
              const soleFindingId = ruleId && group.contributors?.length === 1 ? group.contributors[0].id : undefined;
              const recommendation = group.recommendation;
              return (
                <Fragment key={group.key}>
                  <tr className="border-b border-border transition-colors last:border-0 hover:bg-muted">
                    <td className="max-w-[220px] py-2 pr-4 text-foreground">
                      <div className="truncate">
                        {group.issueLabel}
                        {isConsolidated && (
                          <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                            Combined
                          </Badge>
                        )}
                      </div>
                      {group.technicalLabel && <div className="truncate text-xs text-muted-foreground">{group.technicalLabel}</div>}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{group.pageCount}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={STATUS_VARIANT[group.status]}>{OPPORTUNITY_STATUS_LABEL[group.status]}</Badge>
                    </td>
                    <td className="py-2 pr-4">
                      {group.proofLayer ? (
                        <Badge variant={PROOFLAYER_VARIANT[group.proofLayer]}>{OPPORTUNITY_PROOFLAYER_LABEL[group.proofLayer]}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {recommendation ? (
                        <Link
                          href={`/studio?websiteId=${websiteId}&topic=${encodeURIComponent(recommendation.angle || group.issueLabel)}&sourceRecommendationId=${recommendation.id}`}
                          className="rounded-md border border-input px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
                        >
                          Create draft
                        </Link>
                      ) : group.noAutoFixReason ? (
                        <span className="text-xs text-muted-foreground" title={group.noAutoFixReason}>
                          No automatic fix. See why.
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {suggestions.map((s) => (
                            <Link
                              key={s.platform}
                              href={`/studio?websiteId=${websiteId}&platform=${s.platform}&topic=${encodeURIComponent(
                                `Write content addressing "${group.issueLabel}" on ${group.samplePageUrl}.`
                              )}${soleFindingId ? `&sourceFindingId=${soleFindingId}` : ''}`}
                              title={s.rationale}
                              className="text-xs font-medium text-accent underline-offset-4 hover:underline"
                            >
                              Studio
                            </Link>
                          ))}
                          <Link
                            href="/review"
                            className="rounded-md border border-input px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
                          >
                            Review
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                  {group.contributors && group.contributors.length > 0 && (
                    <tr className="border-b border-border last:border-0">
                      <td colSpan={5} className="pb-2">
                        <details className="rounded-md bg-muted/40 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            {isConsolidated
                              ? `Combined by the orchestrator — ${group.contributors.length} contributing findings`
                              : `${group.contributors.length} contributing finding${group.contributors.length === 1 ? '' : 's'}`}
                          </summary>
                          <div className="mt-2 flex flex-col gap-2">
                            {group.noAutoFixReason && (
                              <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                                <span className="font-medium">Why there&apos;s no auto-fix: </span>
                                {group.noAutoFixReason}
                              </p>
                            )}
                            {isConsolidated && <p className="text-xs text-muted-foreground">{group.consolidationReason}</p>}
                            {group.decisionRecord && (
                              <div className="rounded border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                                <p>Resolution: {group.decisionRecord.resolutionRule}</p>
                                <p>Agreement: {group.decisionRecord.agreement}</p>
                                <p>Final recommendation: {group.decisionRecord.finalRecommendation}</p>
                                <p>Measurement: {group.decisionRecord.measurementPlan}</p>
                              </div>
                            )}
                            {group.contributors.map((c, i) => (
                              <div key={i} className="rounded border border-border bg-background px-2 py-1.5 text-xs">
                                <p className="font-medium text-foreground">
                                  {c.agent} · {c.ruleId}
                                </p>
                                <p className="mt-0.5 text-muted-foreground">{c.pageUrl}</p>
                                <p className="mt-0.5 text-muted-foreground">{c.suggestedAction}</p>
                                {c.limitations && <p className="mt-0.5 italic text-muted-foreground">{c.limitations}</p>}
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  )}
                  {recommendation && (
                    <tr className="border-b border-border last:border-0">
                      <td colSpan={5} className="pb-2">
                        <details className="rounded-md bg-muted/40 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            Evidence and reasoning
                          </summary>
                          <div className="mt-2 flex flex-col gap-2">
                            <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                              <span className="font-medium">Why now: </span>
                              {recommendation.whyNow}
                            </p>
                            <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                              <span className="font-medium">Why it fits: </span>
                              {recommendation.businessRelevance}
                            </p>
                            <p className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                              <span className="font-medium">Angle: </span>
                              {recommendation.angle}
                            </p>
                          </div>
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-col gap-3 md:hidden">
          {top.map((group) => (
            <MobileOpportunityCard key={group.key} group={group} websiteId={websiteId} />
          ))}
        </div>
        {groups.length > BOARD_LIMIT && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {BOARD_LIMIT} of {groups.length} opportunities.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
