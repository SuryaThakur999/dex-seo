import type { CompanyContext } from './company-context';
import { labelConfidence, type NormalizedEvidence } from './evidence-normalizer';
import { guardRecommendationClaims } from './recommendation-claims-guard';

export interface ContentRecommendationDraft {
  topic: string; opportunityType: string; whyNow: string; businessRelevance: string;
  companyEvidenceIds: string[]; externalEvidenceIds: string[]; competitorEvidenceIds: string[];
  angle: string; claimsAllowed: string[]; claimsRequiringVerification: string[];
  differentiationNote: string | null; confidenceLabel: ReturnType<typeof labelConfidence>;
}

export function buildRecommendation(input: {
  companyContext: CompanyContext; evidence: NormalizedEvidence[]; topic: string; draftClaims: string[];
}): ContentRecommendationDraft {
  const { allowed, needsVerification } = guardRecommendationClaims(input.draftClaims, input.evidence);
  return {
    topic: input.topic,
    opportunityType: 'competitor_activity',
    whyNow: input.evidence[0]?.excerpt.slice(0, 200) ?? 'No supporting evidence found.',
    businessRelevance: input.companyContext.name
      ? `Directly relevant to ${input.companyContext.name}'s own market and audience (${input.companyContext.audience ?? 'audience not recorded'}).`
      : 'Business relevance could not be established without a recorded company name.',
    companyEvidenceIds: [], externalEvidenceIds: input.evidence.map((e) => e.canonicalUrl), competitorEvidenceIds: [],
    angle: `What this means for ${input.companyContext.name ?? 'your business'}`,
    claimsAllowed: allowed, claimsRequiringVerification: needsVerification,
    differentiationNote: null,
    confidenceLabel: labelConfidence(input.evidence),
  };
}
