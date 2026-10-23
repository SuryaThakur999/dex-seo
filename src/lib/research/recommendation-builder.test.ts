import { describe, expect, it } from 'vitest';
import { buildRecommendation } from './recommendation-builder';

describe('buildRecommendation', () => {
  it('sets confidenceLabel from the evidence set and strips unsupported claims to claimsRequiringVerification', () => {
    const draft = buildRecommendation({
      companyContext: { name: 'Acme Bakery', domains: ['acme.test'], markets: ['DE'], languages: ['de'], audience: 'Families' },
      evidence: [{
        canonicalUrl: 'https://competitor.test/pricing', title: null, publishedAt: new Date(), excerpt: 'They cut prices 10%.',
        sourceType: 'other', platform: 'competitor_site', entityMatchConfidence: 1, extractionConfidence: 1, primarySource: true, limitations: [],
      }],
      topic: 'Pricing moves in the local bakery market',
      draftClaims: ['A nearby competitor cut prices 10%', 'This will double your foot traffic'],
    });
    expect(draft.confidenceLabel).toBe('verified_market_development');
    expect(draft.claimsAllowed).toContain('A nearby competitor cut prices 10%');
    expect(draft.claimsRequiringVerification).toContain('This will double your foot traffic');
    expect(draft.businessRelevance).toContain('Acme Bakery');
  });

  it('never invents a business name when companyContext has none', () => {
    const draft = buildRecommendation({
      companyContext: { name: null, domains: [], markets: [], languages: [], audience: null },
      evidence: [], topic: 'x', draftClaims: [],
    });
    expect(draft.businessRelevance).not.toContain('null');
    expect(draft.confidenceLabel).toBe('insufficient_evidence');
  });
});
