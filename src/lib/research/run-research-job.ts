import { db } from '@/lib/db';
import { CompetitorSiteProvider } from './providers/competitor-site-provider';
import { GoogleNewsRssProvider } from './providers/google-news-rss-provider';
import { TradePressRssProvider } from './providers/trade-press-rss-provider';
import { researchChannelCapabilities, recordResearchSuccess, recordResearchFailure } from './research-circuit-breaker';
import { normalizeEvidence, labelConfidence } from './evidence-normalizer';
import { resolveCompanyContext } from './company-context';
import { buildRecommendation } from './recommendation-builder';
import type { ResearchPlatform, ResearchResult } from './research-provider';

const WINDOW_DAYS = 30;

async function logStep(researchJobId: string, message: string): Promise<void> {
  await db.researchLogLine.create({ data: { researchJobId, message } });
}

// /api/research/[jobId]/cancel (out of this task's scope) would run in a separate serverless
// invocation from this loop -- the DB row is the only channel between them, same discipline as
// run-scan.ts's isCancelled. Checked once per stage, not continuously.
async function isCancelled(researchJobId: string): Promise<boolean> {
  const job = await db.researchJob.findUnique({ where: { id: researchJobId }, select: { cancelRequested: true } });
  return job?.cancelRequested ?? false;
}

export async function runResearchJob(researchJobId: string): Promise<void> {
  const job = await db.researchJob.findUnique({ where: { id: researchJobId } });
  if (!job) throw new Error(`ResearchJob ${researchJobId} not found`);

  await db.researchJob.update({
    where: { id: researchJobId },
    data: { status: 'running', stage: 'resolve_identity', startedAt: new Date() },
  });

  try {
    await runStages(researchJobId, job);
  } catch (err) {
    // Any error outside a connector's own try/catch (a malformed Website.url, a DB write
    // failure, anything unanticipated) must still resolve the job -- never leave it stuck at
    // 'running' forever with no error message and no completedAt.
    await db.researchJob.update({
      where: { id: researchJobId },
      data: { status: 'failed', error: err instanceof Error ? err.message : 'Unknown error', completedAt: new Date() },
    });
  }
}

async function runStages(researchJobId: string, job: { clientProfileId: string; websiteId: string | null }): Promise<void> {
  const profile = await db.clientProfile.findUnique({
    where: { id: job.clientProfileId },
    include: { websites: { select: { url: true } } },
  });
  if (!profile) {
    await db.researchJob.update({ where: { id: researchJobId }, data: { status: 'failed', error: 'Client profile not found', completedAt: new Date() } });
    return;
  }
  const companyContext = resolveCompanyContext({ ...profile, businessDescription: profile.businessDescription ?? '' }, profile.websites);

  const competitors = await db.competitorEntity.findMany({ where: { clientProfileId: job.clientProfileId } });

  let hadFailure = false;
  const allEvidence: ResearchResult[] = [];

  const channels: ResearchPlatform[] = ['competitor_site', 'google_news_rss', 'trade_press_rss'];
  const capabilities = await researchChannelCapabilities(channels);
  const available = new Set(capabilities.filter((c) => c.available).map((c) => c.channel));

  await db.researchJob.update({ where: { id: researchJobId }, data: { stage: 'gather_competitor_evidence' } });
  if (available.has('competitor_site')) {
    const provider = new CompetitorSiteProvider();
    for (const competitor of competitors) {
      if (!competitor.canonicalDomain) continue;
      if (await isCancelled(researchJobId)) {
        await db.researchJob.update({ where: { id: researchJobId }, data: { status: 'cancelled', completedAt: new Date() } });
        return;
      }
      try {
        const results = await provider.search({ query: competitor.name, windowDays: WINDOW_DAYS, domain: `https://${competitor.canonicalDomain}` });
        allEvidence.push(...results);
        await recordResearchSuccess('competitor_site');
      } catch (err) {
        hadFailure = true;
        await recordResearchFailure('competitor_site');
        await logStep(researchJobId, `competitor_site failed for ${competitor.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
  } else {
    await logStep(researchJobId, 'competitor_site channel unavailable (circuit breaker open) -- skipped');
  }

  if (await isCancelled(researchJobId)) {
    await db.researchJob.update({ where: { id: researchJobId }, data: { status: 'cancelled', completedAt: new Date() } });
    return;
  }

  await db.researchJob.update({ where: { id: researchJobId }, data: { stage: 'gather_news_evidence' } });
  const query = companyContext.name ?? '';
  if (query) {
    if (available.has('google_news_rss')) {
      try {
        const results = await new GoogleNewsRssProvider().search({ query, windowDays: WINDOW_DAYS });
        allEvidence.push(...results);
        await recordResearchSuccess('google_news_rss');
      } catch (err) {
        hadFailure = true;
        await recordResearchFailure('google_news_rss');
        await logStep(researchJobId, `google_news_rss failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    } else {
      await logStep(researchJobId, 'google_news_rss channel unavailable (circuit breaker open) -- skipped');
    }

    if (available.has('trade_press_rss')) {
      try {
        const results = await new TradePressRssProvider([]).search({ query, windowDays: WINDOW_DAYS });
        allEvidence.push(...results);
        await recordResearchSuccess('trade_press_rss');
      } catch (err) {
        hadFailure = true;
        await recordResearchFailure('trade_press_rss');
        await logStep(researchJobId, `trade_press_rss failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    } else {
      await logStep(researchJobId, 'trade_press_rss channel unavailable (circuit breaker open) -- skipped');
    }
  }

  if (await isCancelled(researchJobId)) {
    await db.researchJob.update({ where: { id: researchJobId }, data: { status: 'cancelled', completedAt: new Date() } });
    return;
  }

  await db.researchJob.update({ where: { id: researchJobId }, data: { stage: 'build_recommendations' } });
  const normalized = normalizeEvidence(allEvidence, WINDOW_DAYS);
  if (normalized.length > 0 && job.websiteId && companyContext.name) {
    // entityId is the clientProfileId for every evidence item in this v1 pass, including
    // competitor-sourced evidence -- a per-CompetitorEntity entityId would need resolving which
    // competitor each ResearchResult actually came from, which this job doesn't track yet (the
    // connector loop doesn't tag results by source competitor). Acceptable for v1's single
    // combined recommendation; a future per-competitor breakdown needs that tagging added first.
    await db.evidenceItem.createMany({
      data: normalized.map((e) => ({
        researchJobId, entityId: job.clientProfileId, platform: e.platform, canonicalUrl: e.canonicalUrl,
        title: e.title, publishedAt: e.publishedAt, excerpt: e.excerpt.slice(0, 500), sourceType: e.sourceType,
        entityMatchConfidence: e.entityMatchConfidence, extractionConfidence: e.extractionConfidence,
        primarySource: e.primarySource, limitations: e.limitations,
      })),
    });

    const draft = buildRecommendation({
      companyContext, evidence: normalized,
      topic: `Market activity relevant to ${companyContext.name}`, draftClaims: [],
    });
    await db.contentRecommendation.create({
      data: {
        researchJobId, clientProfileId: job.clientProfileId, websiteId: job.websiteId,
        platform: 'linkedin', audience: companyContext.audience ?? 'General audience',
        topic: draft.topic, opportunityType: draft.opportunityType, whyNow: draft.whyNow,
        businessRelevance: draft.businessRelevance, companyEvidenceIds: draft.companyEvidenceIds,
        externalEvidenceIds: draft.externalEvidenceIds, competitorEvidenceIds: draft.competitorEvidenceIds,
        angle: draft.angle, claimsAllowed: draft.claimsAllowed, claimsRequiringVerification: draft.claimsRequiringVerification,
        differentiationNote: draft.differentiationNote, confidenceLabel: labelConfidence(normalized),
      },
    });
  }

  await db.researchJob.update({
    where: { id: researchJobId },
    data: { status: hadFailure ? 'partial' : 'completed', stage: 'done', completedAt: new Date() },
  });
}
