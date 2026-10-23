import { auth } from '@clerk/nextjs/server';
import { Suspense } from 'react';
import { FileMagnifyingGlass, ListChecks, Link as LinkIcon, Clock } from '@phosphor-icons/react/dist/ssr';
import { notFound } from 'next/navigation';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites, getPerformanceTrend, type DailyPerformance } from '@/lib/gsc-client';
import { GscTrendChart } from '@/components/dashboard/gsc-trend-chart';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UtilityBar } from '@/components/app-shell/utility-bar';
import { StatCard } from '@/components/dashboard/stat-card';
import { LiveScanPanel } from '@/components/dashboard/live-scan-panel';
import { DailyMissionCard } from '@/components/dashboard/daily-mission-card';
import { RealWorkFeed } from '@/components/dashboard/work-feed';
import { CompetitorWatchCard } from '@/components/dashboard/competitor-watch-card';
import { CommandBar } from '@/components/dashboard/command-bar';
import { GuardBreakdown } from '@/components/dashboard/guard-breakdown';
import { MiniBarChart } from '@/components/dashboard/mini-bar-chart';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';
import { DateRangeSelect } from '@/components/dashboard/date-range-select';
import { AiInsightSection } from '@/components/dashboard/ai-insight-section';
import { PassRateBullet } from '@/components/dashboard/pass-rate-bullet';
import { OutcomesSummary } from '@/components/dashboard/outcomes-summary';
import { VerifiedFixesBlock } from '@/components/dashboard/verified-fixes-block';
import { computeVerifiedFixes } from '@/lib/verified-on-rescan';
import { OpportunityBoard } from '@/components/dashboard/opportunity-board';
import { computeOpportunityGroups } from '@/lib/opportunity-board';
import { computeDecisionBreakdown, extractEligibleEdits, computeSourceFingerprint, MIN_EDITS_FOR_SUMMARY } from '@/lib/feedback-analysis';
import { SiteBrief } from '@/components/dashboard/site-brief';
import { MAX_PAGES_PER_SCAN } from '@/lib/run-scan';
import { OutcomesEvidenceTable } from '@/components/dashboard/outcomes-evidence-table';
import { AuditFunnel } from '@/components/dashboard/audit-funnel';
import { CoverageCalendar } from '@/components/dashboard/coverage-calendar';
import { ActivityOverTimeChart } from '@/components/dashboard/activity-over-time-chart';
import { FindingMixDonut } from '@/components/dashboard/finding-mix-donut';
import { GenerationHealthCard } from '@/components/dashboard/generation-health-card';
import { AgentContributionTable } from '@/components/dashboard/agent-contribution-table';
import { FeedbackPatternsCard } from '@/components/dashboard/feedback-patterns-card';
import { MeasurementJourney } from '@/components/dashboard/measurement-journey';
import { PendingMeasurementsList } from '@/components/dashboard/pending-measurements-list';
import { OpportunityMapChart } from '@/components/dashboard/opportunity-map-chart';
import { AgentEvidenceLedger } from '@/components/dashboard/agent-evidence-ledger';
import { AgentEvidenceSummary } from '@/components/dashboard/agent-evidence-summary';
import { NextMission } from '@/components/dashboard/next-mission';
import { computeOpportunityMapPoints } from '@/lib/opportunity-map';
import { computeSiteGraph } from '@/lib/site-graph';
import { SiteGraphChart } from '@/components/dashboard/site-graph';
import { buildEvidenceLedger, buildAgentEvidenceSummary, buildOrchestratorSummaryRow } from '@/lib/agent-evidence-ledger';
import { ScanActivity } from '@/components/dashboard/scan-activity';
import { OVERVIEW_BLOCKS } from '@/lib/overview-layout';
import { TodayCard } from '@/components/dashboard/today-card';
import { PostIdeasCard, type PostIdea } from '@/components/dashboard/post-ideas-card';
import { buildCompetitorWatchItems } from '@/lib/competitor-watch';
import {
  computeDashboardStats,
  computeGuardBreakdown,
  computeActivitySeries,
  computeGuardCatchSeries,
  computeTokenSeries,
  computeJobDelta,
  computeDelta,
  splitByPeriod,
  parseScanResultSummary,
  computePassRate,
  computeOutcomesSummary,
  buildOutcomesEvidenceRows,
  formatRelativeTime,
  computeAuditFunnel,
  computeCoverageCalendar,
  computeFindingsByRule,
  computeFindingsByAgent,
  computeGenerationHealth,
  computeReviewTimeSeries,
  computeFindingsSeries,
  computeDraftSuccessSeries,
  computeTokensPerApprovedDraft,
  computeMedianReviewMinutes,
  formatMinutes,
  computeMeasurementJourney,
  computePendingMeasurements,
} from '@/lib/dashboard-stats';

const VALID_RANGES = [7, 14, 30, 90] as const;

function parseRange(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (VALID_RANGES as readonly number[]).includes(n) ? n : 14;
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: { websiteId: string };
  searchParams: { range?: string; tab?: string };
}) {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  let customer, website, websites;
  try {
    ({ customer, website, websites } = await resolveWebsiteForRequest(userId, params.websiteId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) return notFound();
    throw err;
  }
  const gscConnected = Boolean(website.gscRefreshToken);
  const urlConfirmed = website.url !== PENDING_WEBSITE_URL;
  const gscPropertyPending = gscConnected && !website.gscReconnectRequired && !website.gscPropertyUrl;

  let verifiedSites: string[] = [];
  let siteListError: string | null = null;
  if (gscPropertyPending) {
    try {
      verifiedSites = await listVerifiedSites(decrypt(website.gscRefreshToken!));
    } catch {
      siteListError = 'Could not load your Search Console properties. Try reconnecting.';
    }
  }

  const range = parseRange(searchParams.range);
  const rangeStart = new Date(Date.now() - range * 86400000);

  // Same "resolved" gate run-scan.ts uses before ever calling a GSC data function — a token
  // that's present but reconnect-required or missing its property selection is not a real,
  // usable connection, and the directive is explicit: "Only display GSC traffic, click and
  // impression trends when real connected data exists."
  const gscResolved = gscConnected && !website.gscReconnectRequired && Boolean(website.gscPropertyUrl);
  let gscTrend: DailyPerformance[] = [];
  if (gscResolved) {
    try {
      gscTrend = await getPerformanceTrend(decrypt(website.gscRefreshToken!), website.gscPropertyUrl!, range);
    } catch {
      // Non-fatal -- the page renders everything else normally; GscTrendChart's own
      // not-enough-history message covers an empty array the same as a real API failure.
    }
  }

  const [recentJobs, activityJobs, actions, pendingActions, clientProfile, brandFactRows, findingsInRange, contentRecommendationRows] = urlConfirmed
    ? await Promise.all([
        db.scanJob.findMany({ where: { websiteId: website.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
        db.scanJob.findMany({
          where: { websiteId: website.id },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { createdAt: true, status: true },
        }),
        db.action.findMany({
          where: { websiteId: website.id },
          select: {
            id: true,
            pageUrl: true,
            status: true,
            tokenCost: true,
            createdAt: true,
            actionType: true,
            decidedAt: true,
            generationStatus: true,
            guardResult: { select: { outcome: true } },
            outcomeMeasuredAt: true,
            baselineCapturedAt: true,
            baselinePerformance: true,
            outcomePerformance: true,
          },
        }),
        db.action.findMany({
          where: { websiteId: website.id, status: 'pending' },
          include: { guardResult: true },
          orderBy: { createdAt: 'desc' },
        }),
        db.clientProfile.findUnique({ where: { id: website.clientProfileId }, select: { name: true } }),
        db.customerFact.findMany({ where: { customerId: customer.id }, select: { claim: true }, take: 3 }),
        // Range-scoped, unlike `seoFindings` below (latest-scan-only, to avoid double-
        // counting a still-open issue across scans) — a per-day trend of real Finding
        // creation events is a different, legitimate question than a funnel snapshot.
        db.finding.findMany({ where: { websiteId: website.id, createdAt: { gte: rangeStart } }, select: { createdAt: true } }),
        // Dashboard IA rebuild (2026-10-16 spec): top-3 Post ideas teaser on Overview.
        db.contentRecommendation.findMany({
          where: { websiteId: website.id, status: 'new' },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, topic: true, whyNow: true, createdAt: true },
        }),
      ])
    : [[], [], [], [], null, [], [], []];

  // Dashboard IA rebuild (2026-10-16 spec): Today card's competitor-change count must read the
  // exact same "what counts as a real change" rule CompetitorWatchCard's own route uses (Task 2's
  // buildCompetitorWatchItems), not a second hand-derived count that could silently drift.
  const competitorEntities = urlConfirmed
    ? await db.competitorEntity.findMany({ where: { clientProfileId: website.clientProfileId }, select: { id: true, name: true } })
    : [];
  const competitorNameById = new Map(competitorEntities.map((c) => [c.id, c.name]));
  const competitorEvidence = competitorEntities.length
    ? await db.evidenceItem.findMany({
        where: { entityId: { in: competitorEntities.map((c) => c.id) }, platform: 'competitor_site' },
        orderBy: { retrievedAt: 'desc' },
        take: 20,
        select: { id: true, entityId: true, canonicalUrl: true, excerpt: true, retrievedAt: true, observedMetrics: true },
      })
    : [];
  const competitorChangeCount = buildCompetitorWatchItems(competitorEvidence, competitorNameById).length;

  // Overseer polish (item 4, 2026-10-16): dashboard's "Add website" needs the same new-vs-
  // existing-company choice Settings' AddWebsiteForm already has, so this reads every company
  // name across `websites` the same way Settings' own page.tsx does.
  const otherCompanies = urlConfirmed
    ? (
        await db.clientProfile.findMany({
          where: { id: { in: [...new Set(websites.map((w) => w.clientProfileId))] } },
          select: { id: true, name: true },
        })
      ).map((p) => ({ id: p.id, name: p.name }))
    : [];

  const latestScanJob = recentJobs[0] ?? null;
  // Scoped to the latest scan job only — an unfixed issue reappears as a fresh row every
  // scan (Finding has no upsert/dedup like Action does), so showing all-time rows would
  // pile up duplicates for anything not yet fixed.
  const seoFindings = latestScanJob
    ? await db.finding.findMany({
        where: { websiteId: website.id, scanJobId: latestScanJob.id, agent: { in: ['seo_specialist', 'geo_specialist', 'brand_specialist'] } },
        select: {
          id: true,
          pageUrl: true,
          ruleId: true,
          agent: true,
          severity: true,
          suggestedAction: true,
          confidence: true,
          limitations: true,
          evidence: true,
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      })
    : [];
  // Same latest-scan-only scoping as seoFindings above — page-link edges are re-recorded
  // fresh every scan (see run-scan.ts), not deduped/upserted, so an older scan's rows would
  // otherwise pile up as false structure alongside the current one.
  const pageLinks = latestScanJob
    ? await db.pageLink.findMany({
        where: { websiteId: website.id, scanJobId: latestScanJob.id },
        select: { fromUrl: true, toUrl: true },
      })
    : [];
  const siteGraph = computeSiteGraph(pageLinks, website.url);
  const scanLogLines = latestScanJob
    ? await db.scanLogLine.findMany({
        where: { scanJobId: latestScanJob.id },
        select: { message: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const latestCompletedJob = recentJobs.find((job) => job.status === 'completed') ?? null;
  const latestSummary = latestCompletedJob ? parseScanResultSummary(latestCompletedJob.resultSummary) : null;
  const stats = computeDashboardStats(actions);
  const guardCounts = computeGuardBreakdown(actions);
  const activitySeries = computeActivitySeries(activityJobs, actions, range);
  const guardCatchSeries = computeGuardCatchSeries(actions, range, undefined, activityJobs);
  const tokenSeries = computeTokenSeries(actions, range, undefined, activityJobs);
  const pagesScannedDelta = computeJobDelta(recentJobs);
  const { current: currentWeekActions, previous: previousWeekActions } = splitByPeriod(actions, 7);
  const currentWeekStats = computeDashboardStats(currentWeekActions);
  const previousWeekStats = computeDashboardStats(previousWeekActions);
  const guardCatchesDelta = computeDelta(currentWeekStats.guardCatches, previousWeekStats.guardCatches);
  const passRate = computePassRate(guardCounts);
  // Verified-on-rescan (docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md):
  // works without GSC, so queried unconditionally (gated only by urlConfirmed like the rest of
  // this page's real data, not by gscResolved).
  const [resolvedFindingsForRescan, actionsWithCausalFindings] = urlConfirmed
    ? await Promise.all([
        db.finding.findMany({
          where: { websiteId: website.id, resolution: { in: ['fixed', 'excluded'] } },
          select: { pageUrl: true, ruleId: true, retrievedAt: true, resolvedAt: true, resolution: true, evidence: true },
        }),
        db.action.findMany({
          where: { websiteId: website.id, provenanceRecords: { some: { findings: { some: {} } } } },
          select: { status: true, provenanceRecords: { select: { findings: { select: { ruleId: true } } } } },
        }),
      ])
    : [[], []];
  const rejectionCountsByRuleId: Record<string, { rejected: number; total: number }> = {};
  for (const action of actionsWithCausalFindings) {
    const ruleIds = new Set(action.provenanceRecords.flatMap((pr) => pr.findings.map((f) => f.ruleId)));
    for (const ruleId of ruleIds) {
      const counts = rejectionCountsByRuleId[ruleId] ?? { rejected: 0, total: 0 };
      counts.total += 1;
      if (action.status === 'rejected') counts.rejected += 1;
      rejectionCountsByRuleId[ruleId] = counts;
    }
  }
  const verifiedFixes = computeVerifiedFixes(
    resolvedFindingsForRescan
      .filter((f): f is typeof f & { resolvedAt: Date } => f.resolvedAt !== null)
      .map((f) => ({ ...f, resolution: f.resolution as 'fixed' | 'excluded' })),
    rejectionCountsByRuleId
  );
  const outcomesSummary = computeOutcomesSummary(actions);
  const evidenceRows = buildOutcomesEvidenceRows(actions);
  const measurementJourney = computeMeasurementJourney(actions);
  const pendingMeasurements = computePendingMeasurements(actions);
  const scanTime = latestScanJob?.completedAt ?? latestScanJob?.createdAt ?? new Date();
  const opportunityGroups = computeOpportunityGroups(pendingActions, seoFindings, scanTime);
  const opportunityMapPoints = computeOpportunityMapPoints(opportunityGroups);
  const evidenceLedger = buildEvidenceLedger(scanLogLines);
  const decisionBreakdown = computeDecisionBreakdown(actions);
  const editedActionsById = new Map(
    actions.filter((a) => a.status === 'edited').map((a) => [a.id, { actionType: a.actionType, draftContent: '' }])
  );
  let feedbackCached: { summary: string | null; sourceEditCount: number; generatedAt: Date; isStale: boolean; newEditCount: number } | null = null;
  let feedbackMinEditsNeeded = 0;
  // Gated to match the `urlConfirmed && latestScanJob` condition below that decides whether
  // DashboardTabs (and the feedback-patterns card that consumes these values) renders at all --
  // querying feedbackAnalysis/audit entries when that card can never render would be unused work.
  if (urlConfirmed && latestScanJob) {
    // Single source of truth for "how many eligible edits exist right now" -- the same
    // extractEligibleEdits function the API route uses. Both branches below read from this one
    // computation instead of each deriving their own count, so the page's threshold/staleness
    // math can never diverge from what the route would actually accept.
    const liveAuditEntries = await db.auditLogEntry.findMany({
      where: { actionId: { in: Array.from(editedActionsById.keys()) }, eventType: 'action_decided' },
      select: { id: true, actionId: true, detail: true, createdAt: true },
    });
    const liveEligible = extractEligibleEdits(liveAuditEntries, editedActionsById);

    const cachedFeedbackAnalysis = await db.feedbackAnalysis.findUnique({ where: { websiteId: website.id } });
    if (cachedFeedbackAnalysis) {
      const liveFingerprint = computeSourceFingerprint(liveEligible);
      feedbackCached = {
        summary: cachedFeedbackAnalysis.summary,
        sourceEditCount: cachedFeedbackAnalysis.sourceEditCount,
        generatedAt: cachedFeedbackAnalysis.generatedAt,
        isStale: liveFingerprint !== cachedFeedbackAnalysis.sourceFingerprint,
        // Design doc's exact wording is "N new edits since this analysis" -- clamped to 0
        // since a fingerprint can also go stale from an edit being *replaced* (revert+re-edit),
        // which doesn't grow the count at all.
        newEditCount: Math.max(0, liveEligible.length - cachedFeedbackAnalysis.sourceEditCount),
      };
    } else {
      feedbackMinEditsNeeded = Math.max(0, MIN_EDITS_FOR_SUMMARY - liveEligible.length);
    }
  }
  // Sum of pages across consolidated groups, not group count -- a rule that fires on multiple
  // pages must not silently undercount just because its findings landed in one opportunity.
  const consolidatedCount = opportunityGroups
    .filter((g) => g.key.startsWith('consolidated:'))
    .reduce((sum, g) => sum + g.pageCount, 0);
  const orchestratorRow = buildOrchestratorSummaryRow(consolidatedCount, scanTime);
  const agentEvidenceSummary = [...buildAgentEvidenceSummary(evidenceLedger), ...(orchestratorRow ? [orchestratorRow] : [])];
  // No successful scan has produced crawl data yet — Opportunity Board, Opportunity Map, Site
  // graph, Next mission and Agent evidence would each render their own "nothing yet" card
  // stacked one after another. Collapse them into one compact empty state instead.
  const hasFindingsData =
    opportunityGroups.length > 0 || opportunityMapPoints.length > 0 || siteGraph.nodes.length > 0 || agentEvidenceSummary.length > 0;

  const draftReadyCount = pendingActions.filter((a) => a.generationStatus === 'succeeded').length;
  const approvedCount = actions.filter((a) => a.status === 'approved' || a.status === 'edited').length;
  const auditFunnel = computeAuditFunnel({
    pagesAttempted: latestSummary?.pagesAttempted,
    pagesScanned: latestSummary?.pagesScanned ?? 0,
    findingsCount: seoFindings.length,
    draftReadyCount,
    approvedCount,
  });
  const coverageCalendar = computeCoverageCalendar(activityJobs, range);
  const findingsByRule = computeFindingsByRule(seoFindings);
  const findingsByAgent = computeFindingsByAgent(seoFindings);
  const generationHealth = computeGenerationHealth(actions);
  const tokensPerApprovedDraft = computeTokensPerApprovedDraft(actions);
  const medianReviewMinutes = computeMedianReviewMinutes(actions);
  const findingsSeries = computeFindingsSeries(findingsInRange, range, undefined, activityJobs);
  const draftSuccessSeries = computeDraftSuccessSeries(actions, range, undefined, activityJobs);
  const reviewTimeSeries = computeReviewTimeSeries(actions, range);

  const gscStatus = website.gscReconnectRequired
    ? ('reconnect_required' as const)
    : gscPropertyPending
      ? ('property_pending' as const)
      : gscConnected
        ? ('connected' as const)
        : ('not_connected' as const);
  const siteBriefCrawl = latestSummary
    ? { attempted: latestSummary.pagesAttempted, scanned: latestSummary.pagesScanned, budget: MAX_PAGES_PER_SCAN }
    : null;
  const brandFacts = brandFactRows.map((f) => f.claim);

  return (
    <main className="mx-auto max-w-[1440px] px-6 py-6 sm:px-8">
      {urlConfirmed && (
        <UtilityBar
          websiteUrl={website.url}
          gscConnected={gscConnected}
          lastRefresh={latestScanJob?.completedAt ?? null}
          websites={websites}
          currentWebsiteId={website.id}
          profileName={clientProfile?.name}
          showAddWebsite
          companies={otherCompanies}
        />
      )}

      {urlConfirmed && (
        <div className="mt-3">
          <LiveScanPanel
            key={website.id}
            websiteId={website.id}
            initialJobs={recentJobs}
            opportunitiesFoundCount={seoFindings.length}
            draftsReadyCount={pendingActions.filter((a) => a.generationStatus === 'succeeded').length}
            initialGamePreference={customer.gamePreference}
            autoStartFirstScan={!latestScanJob}
          />
        </div>
      )}

      {!urlConfirmed && (
        <header className="flex flex-wrap items-center justify-between gap-4 py-3">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Dashboard</h1>
        </header>
      )}

      {!urlConfirmed && (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-start gap-3 py-10">
            <LinkIcon className="h-6 w-6 text-accent" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Confirm this website&apos;s URL in Settings before Dex can audit it.
            </p>
            <Button asChild variant="accent">
              <a href="/settings">Go to Settings</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Nothing actionable here — a background sync failure or an empty verified-sites
          list — gets a quiet inline notice, not a full card competing with the command
          panel above it for attention. A real property list to choose from is a genuine
          task and keeps the fuller card+form treatment. Search Console stays secondary. */}
      {urlConfirmed && gscPropertyPending && (siteListError || verifiedSites.length === 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {siteListError ?? 'No verified Search Console properties found for this account.'}
        </p>
      )}

      {urlConfirmed && gscPropertyPending && !siteListError && verifiedSites.length > 0 && (
        <Card className="mt-8">
          <CardContent className="flex flex-col gap-3 py-6">
            <form action="/api/gsc/select-site" method="post" className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="websiteId" value={website.id} />
              <label htmlFor="siteUrl" className="text-sm font-medium text-foreground">
                Choose a verified property:
              </label>
              <select id="siteUrl" name="siteUrl" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
                {verifiedSites.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="accent">
                Use this site
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {urlConfirmed && !latestScanJob && (
        <div id="scan-control" className="scroll-mt-6">
          <div className="mt-4"><DailyMissionCard websiteId={website.id} /></div>
          <p className="mt-3 text-sm text-muted-foreground">
            Dex is running your first scan above. It reads your site, finds pages worth improving and drafts
            fixes, with ProofLayer checking every one before it reaches you.
          </p>
          <div className="mt-4"><RealWorkFeed websiteId={website.id} /></div>
        </div>
      )}

      {urlConfirmed && latestScanJob && (
        <DashboardTabs
          overview={
            <>
              {OVERVIEW_BLOCKS.map((id) => (
                <div key={id} className="mt-4 first:mt-0">
                  {id === 'today' && (
                    <TodayCard
                      websiteId={website.id}
                      pendingReviewCount={stats.pendingCount}
                      competitorChangeCount={competitorChangeCount}
                      postIdeaCount={contentRecommendationRows.length}
                      summary={
                        <Suspense fallback={<div className="h-5 animate-pulse rounded bg-muted" />}>
                          <AiInsightSection
                            customerId={customer.id}
                            input={{
                              pagesScanned: latestSummary?.pagesScanned ?? 0,
                              pagesFlagged: seoFindings.length,
                              guardCatchesDelta: guardCatchesDelta,
                              pendingCount: stats.pendingCount,
                            }}
                          />
                        </Suspense>
                      }
                    />
                  )}
                  {id === 'fixes-for-your-site' && (
                    <div>
                      <h2 className="mb-2 text-lg font-semibold text-foreground">Fixes for your site</h2>
                      <OpportunityBoard groups={opportunityGroups} websiteId={website.id} />
                    </div>
                  )}
                  {id === 'competitors-and-ideas' && (
                    <div id="competitors-and-ideas" className="grid grid-cols-1 gap-4 scroll-mt-6 lg:grid-cols-2">
                      <CompetitorWatchCard clientProfileId={website.clientProfileId} websiteId={website.id} watchedNames={competitorEntities.map((c) => c.name)} />
                      <PostIdeasCard
                        websiteId={website.id}
                        ideas={contentRecommendationRows.map((r): PostIdea => ({ id: r.id, topic: r.topic, whyNow: r.whyNow, sourceDate: r.createdAt.toISOString() }))}
                      />
                    </div>
                  )}
                  {id === 'ask-dex' && <CommandBar websiteId={website.id} />}
                </div>
              ))}
            </>
          }
          analytics={
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Analytics</h2>
                  <p className="mt-1 text-sm text-muted-foreground">How your audits move from discovery to action.</p>
                </div>
                <DateRangeSelect value={range} />
              </div>
              <p className="text-xs text-muted-foreground">
                Outcome measurement (Outcomes tab) uses its own fixed 28-day window regardless of this selector.
              </p>

              <ScanActivity jobs={recentJobs} />

              <div className="mt-4">
                <RealWorkFeed websiteId={website.id} />
              </div>

              {/* Findings come right after the terminal, ahead of site-context/analytics below —
                  the highest-priority thing a returning user needs is "what did Dex find," not
                  a stat grid they've already seen. */}
              {hasFindingsData ? (
                <>
                  <div id="findings" className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
                    <Card>
                      <CardContent className="flex flex-col gap-3 pt-6">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Opportunity map</h3>
                          <p className="text-xs text-muted-foreground">Real severity vs. effort for open findings.</p>
                        </div>
                        <OpportunityMapChart points={opportunityMapPoints} />
                      </CardContent>
                    </Card>
                  </div>

                  <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
                    <Card>
                      <CardContent className="flex flex-col gap-3 pt-6">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Site graph</h3>
                          <p className="text-xs text-muted-foreground">
                            Real internal-link structure from the latest scan.
                          </p>
                        </div>
                        <SiteGraphChart graph={siteGraph} homepageUrl={website.url} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="flex flex-col gap-3 pt-6">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Next mission</h3>
                        </div>
                        <NextMission group={opportunityGroups[0] ?? null} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-0">
                        <div>
                          <CardTitle className="text-sm font-semibold">Agent evidence</CardTitle>
                          <p className="text-xs text-muted-foreground">A record of what Dex has checked so far.</p>
                        </div>
                        <a href="#agent-evidence-ledger" className="shrink-0 text-xs font-medium text-accent underline-offset-4 hover:underline">
                          View full timeline &rarr;
                        </a>
                      </CardHeader>
                      <CardContent className="pt-3">
                        <AgentEvidenceSummary rows={agentEvidenceSummary} />
                      </CardContent>
                    </Card>
                  </div>
                </>
              ) : (
                <div id="findings" className="mt-6">
                  <Card>
                    <CardContent className="flex flex-col gap-1 pt-6">
                      <h3 className="text-sm font-semibold text-foreground">No findings yet</h3>
                      <p className="text-sm text-muted-foreground">
                        {latestScanJob?.status === 'failed'
                          ? 'The latest scan failed before it could crawl any pages, so there are no opportunities, site graph or agent activity to show yet. Fix the issue above and run another scan.'
                          : 'Run a scan to find opportunities, map your site and see what Dex checked.'}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}

              <div id="agent-evidence-ledger" className="mt-6 scroll-mt-6">
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Agent evidence ledger</h3>
                      <p className="text-xs text-muted-foreground">Real events from the latest scan.</p>
                    </div>
                    <AgentEvidenceLedger entries={evidenceLedger} />
                  </CardContent>
                </Card>
              </div>

              <div className="mt-6">
                <SiteBrief
                  websiteUrl={website.url}
                  clientProfileName={clientProfile?.name ?? 'Default'}
                  lastAuditAt={latestScanJob?.completedAt ?? latestScanJob?.createdAt ?? null}
                  lastAuditStatus={latestScanJob?.status ?? null}
                  gscStatus={gscStatus}
                  crawl={siteBriefCrawl}
                  brandFacts={brandFacts}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Pages crawled"
                  value={String(latestSummary?.pagesScanned ?? 0)}
                  numericValue={latestSummary?.pagesScanned ?? 0}
                  hint="Last scan"
                  icon={<FileMagnifyingGlass size={16} weight="regular" />}
                  delta={pagesScannedDelta}
                />
                <StatCard
                  label="Findings created"
                  value={String(seoFindings.length)}
                  numericValue={seoFindings.length}
                  hint="Last scan"
                  icon={<ListChecks size={16} weight="regular" />}
                />
                <StatCard
                  label="Drafts ready"
                  value={String(draftReadyCount)}
                  numericValue={draftReadyCount}
                  hint="Awaiting review"
                  icon={<FileMagnifyingGlass size={16} weight="regular" />}
                  tone="accent"
                />
                <StatCard
                  label="Median review time"
                  value={medianReviewMinutes === null ? '—' : formatMinutes(medianReviewMinutes)}
                  numericValue={medianReviewMinutes ?? 0}
                  hint={medianReviewMinutes === null ? 'Nothing reviewed yet' : 'All-time median'}
                  icon={<Clock size={16} weight="regular" />}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Audit funnel</h3>
                      <p className="text-xs text-muted-foreground">Crawled/Findings/Draft-ready from your most recent scan; Approved is all-time.</p>
                    </div>
                    <AuditFunnel stages={auditFunnel} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Data coverage</h3>
                      <p className="text-xs text-muted-foreground">When we&apos;ve scanned your site, last {range} days.</p>
                    </div>
                    <CoverageCalendar days={coverageCalendar} />
                    <div className="border-t border-border pt-3">
                      <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <LinkIcon size={14} weight="regular" aria-hidden />
                        Google performance
                        {!gscConnected && <Badge variant="outline">Unavailable</Badge>}
                      </h4>
                      {gscResolved ? (
                        <div className="mt-2">
                          <GscTrendChart data={gscTrend} />
                        </div>
                      ) : gscConnected ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Search Console is connected, but not fully set up yet
                          {website.gscReconnectRequired ? ' (reconnect needed)' : ' (choose a property in Settings)'}.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Connect Google Search Console to see impressions, clicks, and query data alongside your audit
                          activity.{' '}
                          <a
                            href={`/api/gsc/connect?websiteId=${website.id}`}
                            className="font-medium text-accent underline-offset-4 hover:underline"
                          >
                            Connect GSC
                          </a>
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Activity over time</h3>
                    <p className="text-xs text-muted-foreground">Daily audit activity and outcomes, last {range} days.</p>
                  </div>
                  <ActivityOverTimeChart
                    crawl={activitySeries.map((d) => ({ date: d.date, value: d.scans }))}
                    findings={findingsSeries}
                    drafts={draftSuccessSeries}
                    review={reviewTimeSeries}
                  />
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Finding mix</h3>
                      <p className="text-xs text-muted-foreground">Breakdown of findings by type, last scan.</p>
                    </div>
                    <FindingMixDonut counts={findingsByRule} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Generation health</h3>
                      <p className="text-xs text-muted-foreground">Status of AI draft generation, all-time.</p>
                    </div>
                    <GenerationHealthCard health={generationHealth} tokensPerApprovedDraft={tokensPerApprovedDraft} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Agent contribution</h3>
                      <p className="text-xs text-muted-foreground">Findings from the last scan, by agent.</p>
                    </div>
                    <AgentContributionTable counts={findingsByAgent} />
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PassRateBullet data={passRate} />
                <GuardBreakdown counts={guardCounts} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 rounded-lg border border-border p-4">
                  <span className="text-xs font-medium text-muted-foreground">ProofLayer catches</span>
                  <span className="text-[10px] text-muted-foreground">flags + blocks / day · last {range}d</span>
                  <MiniBarChart data={guardCatchSeries} dataKey="value" label={`ProofLayer catches per day, last ${range} days`} />
                </div>
                <div className="flex flex-col gap-1.5 rounded-lg border border-border p-4">
                  <span className="text-xs font-medium text-muted-foreground">Tokens spent</span>
                  <span className="text-[10px] text-muted-foreground">tokens / day · last {range}d</span>
                  <MiniBarChart data={tokenSeries} dataKey="value" color="var(--dex-app-amber)" label={`Tokens spent per day, last ${range} days`} />
                </div>
              </div>

              <Card>
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Feedback patterns</h3>
                    <p className="text-xs text-muted-foreground">Real approve/reject/edit history, and an optional AI summary of recurring edit patterns.</p>
                  </div>
                  <FeedbackPatternsCard
                    websiteId={website.id}
                    breakdown={decisionBreakdown}
                    cached={feedbackCached}
                    minEditsNeeded={feedbackMinEditsNeeded}
                  />
                </CardContent>
              </Card>
            </div>
          }
          outcomes={
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Outcomes</h2>
                <p className="mt-1 text-sm text-muted-foreground">From approved change to measured evidence.</p>
              </div>

              <VerifiedFixesBlock data={verifiedFixes} loading={false} />

              {/* Directive: "Separate operational outcomes from measured search outcomes." */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-medium text-muted-foreground">Operational outcomes</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{measurementJourney.approved}</p>
                  <p className="text-xs text-muted-foreground">
                    Changes approved and applied in Dex, all-time. This confirms the change went through — it does
                    not by itself prove search traffic changed.
                  </p>
                </div>
                <OutcomesSummary data={outcomesSummary} />
              </div>

              <Card>
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Measurement journey</h3>
                    <p className="text-xs text-muted-foreground">From approval to evidence. Each change follows the same path.</p>
                  </div>
                  <MeasurementJourney data={measurementJourney} />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Awaiting measurement</h3>
                    <p className="text-xs text-muted-foreground">
                      {pendingMeasurements.length} change{pendingMeasurements.length === 1 ? '' : 's'} in the 28-day
                      observation window.
                    </p>
                  </div>
                  <PendingMeasurementsList items={pendingMeasurements} />
                </CardContent>
              </Card>

              <OutcomesEvidenceTable rows={evidenceRows} />
            </div>
          }
        />
      )}
    </main>
  );
}
