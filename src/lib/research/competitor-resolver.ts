export type CompetitorClassification = 'direct' | 'indirect' | 'adjacent' | 'unknown';

export interface CompetitorClassificationResult {
  classification: CompetitorClassification;
  reason: string;
}

export interface CompetitorCandidate {
  name: string;
  canonicalDomain: string | null;
}

// Never auto-merge two candidates whose name matches if their domain differs -- a same-sounding
// name across unrelated businesses is a real, common collision, not a dedup opportunity.
export function classifyCompetitor(
  candidate: CompetitorCandidate,
  existingEntity?: CompetitorCandidate,
): CompetitorClassificationResult {
  if (!existingEntity) {
    return { classification: 'unknown', reason: 'No existing entity to compare against; needs human confirmation.' };
  }
  if (candidate.name === existingEntity.name && candidate.canonicalDomain !== existingEntity.canonicalDomain) {
    return {
      classification: 'unknown',
      reason: `same name, different domain (${candidate.canonicalDomain ?? 'none'} vs ${existingEntity.canonicalDomain ?? 'none'}) -- likely two unrelated businesses, not a match.`,
    };
  }
  if (candidate.canonicalDomain && candidate.canonicalDomain === existingEntity.canonicalDomain) {
    return { classification: 'direct', reason: 'Matches an existing entity by domain.' };
  }
  return { classification: 'unknown', reason: 'No confident match against an existing entity.' };
}
