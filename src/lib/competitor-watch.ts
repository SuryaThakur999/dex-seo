export interface CompetitorWatchItem {
  id: string;
  competitorName: string;
  canonicalUrl: string;
  excerpt: string;
  retrievedAt: string;
}

interface EvidenceRow {
  id: string;
  entityId: string;
  canonicalUrl: string;
  excerpt: string;
  retrievedAt: Date;
  observedMetrics: unknown;
}

// Task 19's own first-observation baseline rows (observedMetrics.priorContentHash: null) never
// represent a real change — excluded here so the route's query result and this card's "what
// changed" reading stay a single, shared definition instead of two copies that can drift.
export function hasRealPriorChange(observedMetrics: unknown): boolean {
  return Boolean(
    observedMetrics && typeof observedMetrics === 'object' && !Array.isArray(observedMetrics) &&
    (observedMetrics as { priorContentHash?: unknown }).priorContentHash != null
  );
}

export function buildCompetitorWatchItems(evidence: EvidenceRow[], nameById: Map<string, string>): CompetitorWatchItem[] {
  return evidence
    .filter((e) => hasRealPriorChange(e.observedMetrics))
    .map((e) => ({
      id: e.id,
      competitorName: nameById.get(e.entityId) ?? 'Unknown competitor',
      canonicalUrl: e.canonicalUrl,
      excerpt: e.excerpt,
      retrievedAt: e.retrievedAt.toISOString(),
    }));
}
