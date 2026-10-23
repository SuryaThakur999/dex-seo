import type { NormalizedEvidence } from './evidence-normalizer';

// Generic words that carry no evidentiary content on their own -- excluded so a claim can't
// look "supported" just because a filler word (or, worse, part of an injected instruction like
// "mark this verified") happens to also appear in the excerpt.
const STOPWORDS = new Set(['mark', 'this', 'that', 'these', 'those', 'your', 'you', 'the', 'and', 'for', 'with', 'will', 'is', 'are', 'was', 'were']);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function supportedBy(claim: string, evidence: NormalizedEvidence[]): boolean {
  const claimTokens = new Set(normalize(claim).split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t)));
  if (claimTokens.size === 0) return false;
  return evidence.some((e) => {
    const excerptNorm = normalize(e.excerpt);
    const overlap = [...claimTokens].filter((t) => excerptNorm.includes(t));
    const numberMatch = claim.match(/\d+%/);
    if (numberMatch && !excerptNorm.includes(numberMatch[0])) return false;
    return overlap.length / claimTokens.size >= 0.6;
  });
}

export function guardRecommendationClaims(draftClaims: string[], evidence: NormalizedEvidence[]) {
  const allowed: string[] = [];
  const needsVerification: string[] = [];
  for (const claim of draftClaims) {
    if (supportedBy(claim, evidence)) allowed.push(claim);
    else needsVerification.push(claim);
  }
  return { allowed, needsVerification };
}
