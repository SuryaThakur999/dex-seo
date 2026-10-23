import type { ResearchResult } from './research-provider';

export interface NormalizedEvidence extends ResearchResult {
  entityMatchConfidence: number;
  extractionConfidence: number;
  primarySource: boolean;
  limitations: string[];
}

export type ConfidenceLabel = 'verified_market_development' | 'repeated_discussion' | 'insufficient_evidence';

const PRIMARY_PLATFORMS = new Set(['competitor_site', 'own_site']);

export function normalizeEvidence(results: ResearchResult[], windowDays: number, now: Date = new Date()): NormalizedEvidence[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const kept: NormalizedEvidence[] = [];
  for (const result of results) {
    if (result.publishedAt && result.publishedAt.getTime() < cutoff) continue; // provably stale, dropped
    if (seen.has(result.canonicalUrl)) continue; // dedup: first (earliest-retrieved) copy wins
    seen.add(result.canonicalUrl);
    const undated = result.publishedAt === null;
    kept.push({
      ...result,
      entityMatchConfidence: 1,
      extractionConfidence: undated ? 0.3 : 0.9,
      primarySource: PRIMARY_PLATFORMS.has(result.platform),
      limitations: undated ? ['Source gave no publish date; recency cannot be verified.'] : [],
    });
  }
  return kept;
}

export function labelConfidence(evidence: NormalizedEvidence[]): ConfidenceLabel {
  if (evidence.length === 0) return 'insufficient_evidence';
  if (evidence.some((e) => e.primarySource)) return 'verified_market_development';
  if (evidence.length >= 2) return 'repeated_discussion';
  return 'insufficient_evidence';
}
