import { createHash } from 'node:crypto';
import type { EvidenceItem } from '@prisma/client';
import { db } from '@/lib/db';
import { CompetitorSiteProvider } from './providers/competitor-site-provider';
import { researchChannelCapabilities, recordResearchSuccess, recordResearchFailure } from './research-circuit-breaker';

// Per-run cap (design doc 1ee6b22): at most 5 competitors, 4 pages each (home/services/
// pricing/blog index) -- a real ceiling on how many of a customer's competitors' sites Dex
// reads per week, not an arbitrary number.
const MAX_COMPETITORS = 5;
const COMPETITOR_PAGES: { label: string; path: string; sourceType: 'product_page' | 'pricing_page' | 'blog' }[] = [
  { label: 'Home', path: '', sourceType: 'product_page' },
  { label: 'Services', path: '/services', sourceType: 'product_page' },
  { label: 'Pricing', path: '/pricing', sourceType: 'pricing_page' },
  { label: 'Blog', path: '/blog', sourceType: 'blog' },
];

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function logStep(researchJobId: string, message: string): Promise<void> {
  await db.researchLogLine.create({ data: { researchJobId, message } });
}

interface ObservedMetrics {
  contentHash?: string;
}

function readContentHash(observedMetrics: unknown): string | undefined {
  if (observedMetrics && typeof observedMetrics === 'object' && !Array.isArray(observedMetrics)) {
    return (observedMetrics as ObservedMetrics).contentHash;
  }
  return undefined;
}

// Weekly change detection for a customer's tracked competitors. No new schema: EvidenceItem's
// already-approved `observedMetrics` Json field carries `{ contentHash }`, compared against the
// most recent prior EvidenceItem for the same (entityId, platform, canonicalUrl) triple.
export async function runCompetitorWatch(clientProfileId: string): Promise<{ changed: EvidenceItem[] }> {
  const profile = await db.clientProfile.findUnique({ where: { id: clientProfileId }, select: { customerId: true } });
  if (!profile) return { changed: [] };

  const job = await db.researchJob.create({
    data: { customerId: profile.customerId, clientProfileId, status: 'running', stage: 'competitor_watch', startedAt: new Date() },
  });

  const allCompetitors = await db.competitorEntity.findMany({ where: { clientProfileId }, orderBy: { createdAt: 'asc' } });
  // Domain-less competitors (not yet resolved) can't be fetched at all -- filtered out before
  // spending one of the MAX_COMPETITORS slots on an entity with nothing to check.
  const competitors = allCompetitors.filter((c) => c.canonicalDomain).slice(0, MAX_COMPETITORS);

  const changed: EvidenceItem[] = [];
  const [capability] = await researchChannelCapabilities(['competitor_site']);

  if (!capability?.available) {
    await logStep(job.id, 'competitor_site channel unavailable (circuit breaker open) -- skipped');
  } else {
    const provider = new CompetitorSiteProvider();
    for (const competitor of competitors) {
      for (const page of COMPETITOR_PAGES) {
        const url = `https://${competitor.canonicalDomain}${page.path}`;
        let document;
        try {
          document = await provider.read({ url });
          await recordResearchSuccess('competitor_site');
        } catch (err) {
          await recordResearchFailure('competitor_site');
          // Never a silent "no change" and never a thrown error that fails the whole job --
          // an unreachable page is an honest "could not check", logged and skipped.
          await logStep(job.id, `could not check ${competitor.name} — ${page.label} (${url}): ${err instanceof Error ? err.message : 'unknown error'}`);
          continue;
        }

        const contentHash = hashContent(document.text);
        const prior = await db.evidenceItem.findFirst({
          where: { entityId: competitor.id, platform: 'competitor_site', canonicalUrl: document.canonicalUrl },
          orderBy: { retrievedAt: 'desc' },
        });
        const priorHash = prior ? readContentHash(prior.observedMetrics) : undefined;

        if (prior && priorHash === contentHash) continue; // unchanged -- nothing new to record

        const created = await db.evidenceItem.create({
          data: {
            researchJobId: job.id,
            entityId: competitor.id,
            platform: 'competitor_site',
            canonicalUrl: document.canonicalUrl,
            title: `${competitor.name} — ${page.label}`,
            publishedAt: null,
            excerpt: document.text.slice(0, 500),
            sourceType: page.sourceType,
            observedMetrics: {
              contentHash,
              priorContentHash: priorHash ?? null,
              priorRetrievedAt: prior ? prior.retrievedAt.toISOString() : null,
            },
            entityMatchConfidence: 1,
            extractionConfidence: 1,
            primarySource: true,
            limitations: [],
          },
        });

        // A first-ever observation stores a baseline for next week's comparison, but isn't
        // itself a "change" to surface -- there was nothing to compare it against yet.
        if (prior) changed.push(created);
      }
    }
  }

  await db.researchJob.update({ where: { id: job.id }, data: { status: 'completed', stage: 'done', completedAt: new Date() } });
  return { changed };
}
