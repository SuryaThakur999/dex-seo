import { describe, it, expect } from 'vitest';
import { computeOpportunityGroups } from './opportunity-board';

function finding(overrides: { id?: string; pageUrl: string; ruleId: string; severity: 'low' | 'medium' | 'high'; agent?: string }) {
  return {
    id: `${overrides.ruleId}:${overrides.pageUrl}`,
    agent: 'seo_specialist',
    evidence: {},
    suggestedAction: 'Fix it.',
    limitations: null,
    ...overrides,
  };
}

describe('computeOpportunityGroups', () => {
  it('groups findings by ruleId with a real distinct-page count, not a row per page', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/a', ruleId: 'missing_canonical', severity: 'medium' }),
        finding({ pageUrl: '/b', ruleId: 'missing_canonical', severity: 'medium' }),
        finding({ pageUrl: '/c', ruleId: 'zero_internal_links', severity: 'medium' }),
      ]
    );

    const canonical = groups.find((g) => g.key === 'finding:missing_canonical');
    expect(canonical?.pageCount).toBe(2);
    expect(canonical?.issueLabel).toBe('Missing canonical');
    expect(canonical?.status).toBe('found');
    expect(canonical?.proofLayer).toBeNull();
  });

  it('falls back to the raw ruleId for an unrecognized rule rather than a made-up label', () => {
    const groups = computeOpportunityGroups([], [finding({ pageUrl: '/a', ruleId: 'some_future_rule', severity: 'medium' })]);

    expect(groups[0].issueLabel).toBe('some_future_rule');
  });

  it('summarizes an action group as draft_ready/passed only when every draft in the group passed', () => {
    const groups = computeOpportunityGroups(
      [
        { pageUrl: '/a', actionType: 'meta_description', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
        { pageUrl: '/b', actionType: 'meta_description', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
      ],
      []
    );

    expect(groups[0]).toMatchObject({ status: 'draft_ready', proofLayer: 'passed', pageCount: 2 });
  });

  it('surfaces needs_review/blocked when any action in the group was blocked, even if others passed', () => {
    const groups = computeOpportunityGroups(
      [
        { pageUrl: '/a', actionType: 'meta_description', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
        { pageUrl: '/b', actionType: 'meta_description', guardResult: { outcome: 'block' }, generationStatus: 'succeeded' },
      ],
      []
    );

    expect(groups[0]).toMatchObject({ status: 'needs_review', proofLayer: 'blocked' });
  });

  it('marks the group failed (no ProofLayer verdict) when any draft in it failed to generate, even alongside a passed one', () => {
    const groups = computeOpportunityGroups(
      [
        { pageUrl: '/a', actionType: 'meta_description', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
        { pageUrl: '/b', actionType: 'meta_description', guardResult: null, generationStatus: 'failed' },
      ],
      []
    );

    expect(groups[0]).toMatchObject({ status: 'failed', proofLayer: null });
  });

  it('sorts groups by page count descending, largest opportunity first', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/a', ruleId: 'small_issue', severity: 'medium' }),
        finding({ pageUrl: '/b', ruleId: 'big_issue', severity: 'medium' }),
        finding({ pageUrl: '/c', ruleId: 'big_issue', severity: 'medium' }),
        finding({ pageUrl: '/d', ruleId: 'big_issue', severity: 'medium' }),
      ]
    );

    expect(groups[0].key).toBe('finding:big_issue');
    expect(groups[0].pageCount).toBe(3);
  });

  it('returns an empty list when there is nothing to show, not a fabricated placeholder row', () => {
    expect(computeOpportunityGroups([], [])).toEqual([]);
  });

  it('carries the worst real severity in a finding group', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/a', ruleId: 'x', severity: 'low' }),
        finding({ pageUrl: '/b', ruleId: 'x', severity: 'high' }),
        finding({ pageUrl: '/c', ruleId: 'x', severity: 'medium' }),
      ]
    );
    expect(groups[0].severity).toBe('high');
  });

  it('leaves severity null for an Action-only group — no severity field exists on Action', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/a', actionType: 'meta_description', guardResult: null, generationStatus: 'succeeded' }],
      []
    );
    expect(groups[0].severity).toBeNull();
  });

  it('consolidates the verified SEO/GEO zero-JSON-LD duplicate into one opportunity, preserving both contributors', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
      ]
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('consolidated:seo_geo_missing_structured_data');
    expect(groups[0].pageCount).toBe(1);
    expect(groups[0].contributors).toHaveLength(2);
    expect(groups[0].contributors?.map((c) => c.ruleId).sort()).toEqual(['missing_entity_markup', 'missing_structured_data']);
    expect(groups[0].contributors?.map((c) => c.agent).sort()).toEqual(['geo_specialist', 'seo_specialist']);
    expect(groups[0].consolidationReason).toBeTruthy();
  });

  it('sums real page count across a consolidated group spanning multiple pages, not a group count of 1', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
        finding({ pageUrl: '/about', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/about', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
      ]
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('consolidated:seo_geo_missing_structured_data');
    expect(groups[0].pageCount).toBe(2);
  });

  it('does not consolidate the same two rule IDs when they occur on different pages', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/other', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
      ]
    );

    expect(groups.some((g) => g.key.startsWith('consolidated:'))).toBe(false);
    expect(groups.find((g) => g.key === 'finding:missing_structured_data')).toBeTruthy();
    expect(groups.find((g) => g.key === 'finding:missing_entity_markup')).toBeTruthy();
  });

  it('leaves missing_entity_markup alone when missing_structured_data is absent for that page (structured data exists, entity type does not)', () => {
    const groups = computeOpportunityGroups([], [finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' })]);

    expect(groups.some((g) => g.key.startsWith('consolidated:'))).toBe(false);
    expect(groups[0].key).toBe('finding:missing_entity_markup');
  });

  it('is idempotent — running the same findings through twice produces the same consolidated result', () => {
    const input = [
      finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
      finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
    ];
    const now = new Date('2026-01-01T00:00:00Z');
    expect(computeOpportunityGroups([], input, now)).toEqual(computeOpportunityGroups([], input, now));
  });

  it('attaches a decision record to consolidated groups, with none on non-consolidated groups', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
        finding({ pageUrl: '/other', ruleId: 'zero_internal_links', severity: 'medium', agent: 'seo_specialist' }),
      ]
    );

    const consolidatedGroup = groups.find((g) => g.key.startsWith('consolidated:'));
    expect(consolidatedGroup?.decisionRecord).toBeDefined();
    expect(consolidatedGroup?.decisionRecord?.agreement).toBe('agreed');
    expect(consolidatedGroup?.decisionRecord?.recommendations).toHaveLength(2);

    const plainGroup = groups.find((g) => g.key === 'finding:zero_internal_links');
    expect(plainGroup?.decisionRecord).toBeUndefined();
  });

  it('supersedes a missing_canonical Finding with the canonical_fix Action group for the same page (Phase 1F)', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/a', actionType: 'canonical_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' }],
      [finding({ pageUrl: '/a', ruleId: 'missing_canonical', severity: 'medium' })]
    );

    expect(groups.find((g) => g.key === 'finding:missing_canonical')).toBeUndefined();
    expect(groups.find((g) => g.key === 'action:canonical_fix')).toMatchObject({
      status: 'draft_ready',
      issueLabel: 'Tell Google which page is the main one',
      technicalLabel: 'Canonical tag fix',
    });
  });

  it('keeps a missing_canonical Finding visible for a page that has no canonical_fix Action yet', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/a', actionType: 'canonical_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' }],
      [finding({ pageUrl: '/b', ruleId: 'missing_canonical', severity: 'medium' })]
    );

    expect(groups.find((g) => g.key === 'finding:missing_canonical')).toMatchObject({ pageCount: 1 });
  });

  it('does not supersede a rule with no rule-to-actionType mapping, even if an unrelated Action exists', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/a', actionType: 'meta_description', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' }],
      [finding({ pageUrl: '/a', ruleId: 'missing_canonical', severity: 'medium' })]
    );

    expect(groups.find((g) => g.key === 'finding:missing_canonical')).toMatchObject({ pageCount: 1 });
  });

  it('drops a consolidated missing_structured_data + missing_entity_markup page once BOTH real fixes exist for it (Phase 1F)', () => {
    const groups = computeOpportunityGroups(
      [
        { pageUrl: '/', actionType: 'structured_data_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
        { pageUrl: '/', actionType: 'entity_markup_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
      ],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
      ]
    );

    expect(groups.some((g) => g.key.startsWith('consolidated:'))).toBe(false);
    expect(groups.find((g) => g.key === 'action:structured_data_fix')).toBeTruthy();
    expect(groups.find((g) => g.key === 'action:entity_markup_fix')).toBeTruthy();
  });

  it('keeps a consolidated page visible when only ONE of the two real fixes exists for it', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/', actionType: 'structured_data_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' }],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
      ]
    );

    const consolidatedGroup = groups.find((g) => g.key.startsWith('consolidated:'));
    expect(consolidatedGroup).toMatchObject({ pageCount: 1 });
  });

  it('drops only the actioned page from a consolidated group spanning multiple pages, keeping the other visible', () => {
    const groups = computeOpportunityGroups(
      [
        { pageUrl: '/', actionType: 'structured_data_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
        { pageUrl: '/', actionType: 'entity_markup_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
      ],
      [
        finding({ pageUrl: '/', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
        finding({ pageUrl: '/about', ruleId: 'missing_structured_data', severity: 'low', agent: 'seo_specialist' }),
        finding({ pageUrl: '/about', ruleId: 'missing_entity_markup', severity: 'low', agent: 'geo_specialist' }),
      ]
    );

    const consolidatedGroup = groups.find((g) => g.key.startsWith('consolidated:'));
    expect(consolidatedGroup).toMatchObject({ pageCount: 1, samplePageUrl: '/about' });
  });

  it('labels the two new deterministic-remediation action groups honestly, not a raw actionType string', () => {
    const groups = computeOpportunityGroups(
      [
        { pageUrl: '/a', actionType: 'structured_data_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
        { pageUrl: '/b', actionType: 'entity_markup_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' },
      ],
      []
    );

    expect(groups.find((g) => g.key === 'action:structured_data_fix')).toMatchObject({
      issueLabel: 'Help search engines understand this page',
      technicalLabel: 'Structured data fix',
    });
    expect(groups.find((g) => g.key === 'action:entity_markup_fix')).toMatchObject({
      issueLabel: 'Help search engines know who you are',
      technicalLabel: 'Entity markup fix',
    });
  });

  it('supersedes a restricted_wording_found Finding with the restricted_wording_fix Action group for the same page', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/a', actionType: 'restricted_wording_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' }],
      [finding({ pageUrl: '/a', ruleId: 'restricted_wording_found', severity: 'medium', agent: 'brand_specialist' })]
    );

    expect(groups.find((g) => g.key === 'finding:restricted_wording_found')).toBeUndefined();
    expect(groups.find((g) => g.key === 'action:restricted_wording_fix')).toMatchObject({
      status: 'draft_ready',
      issueLabel: 'Remove wording that could get your account flagged',
      technicalLabel: 'Restricted wording fix',
    });
  });

  it('shows restricted_wording_fix as failed when its generation failed, same as any other action group', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/a', actionType: 'restricted_wording_fix', guardResult: null, generationStatus: 'failed' }],
      [finding({ pageUrl: '/a', ruleId: 'restricted_wording_found', severity: 'medium', agent: 'brand_specialist' })]
    );

    expect(groups.find((g) => g.key === 'action:restricted_wording_fix')).toMatchObject({ status: 'failed', proofLayer: null });
  });

  it('supersedes a zero_internal_links Finding with the internal_link_fix Action group for the same page', () => {
    const groups = computeOpportunityGroups(
      [{ pageUrl: '/orphan', actionType: 'internal_link_fix', guardResult: { outcome: 'pass' }, generationStatus: 'succeeded' }],
      [finding({ pageUrl: '/orphan', ruleId: 'zero_internal_links', severity: 'medium', agent: 'seo_specialist' })]
    );

    expect(groups.find((g) => g.key === 'finding:zero_internal_links')).toBeUndefined();
    expect(groups.find((g) => g.key === 'action:internal_link_fix')).toMatchObject({
      status: 'draft_ready',
      issueLabel: 'Add a link to this page from other pages on your site',
      technicalLabel: 'Internal link suggestion',
    });
  });

  it('sets a real noAutoFixReason for each of the 4 human-decision/informational rule IDs (Phase 1F)', () => {
    const groups = computeOpportunityGroups(
      [],
      [
        finding({ pageUrl: '/a', ruleId: 'canonical_points_elsewhere', severity: 'low' }),
        finding({ pageUrl: '/b', ruleId: 'unverified_claim_candidate', severity: 'medium', agent: 'brand_specialist' }),
        finding({ pageUrl: '/c', ruleId: 'ai_crawlers_blocked', severity: 'medium', agent: 'geo_specialist' }),
        finding({ pageUrl: '/d', ruleId: 'broken_page_status', severity: 'high' }),
      ]
    );

    for (const ruleId of ['canonical_points_elsewhere', 'unverified_claim_candidate', 'ai_crawlers_blocked', 'broken_page_status']) {
      const g = groups.find((group) => group.key === `finding:${ruleId}`);
      expect(g?.noAutoFixReason, `expected a reason for ${ruleId}`).toBeTruthy();
    }
  });

  it('leaves noAutoFixReason unset for a rule that has a real fix path', () => {
    const groups = computeOpportunityGroups([], [finding({ pageUrl: '/a', ruleId: 'missing_canonical', severity: 'medium' })]);
    expect(groups[0].noAutoFixReason).toBeUndefined();
  });

  it('gives broken_page_status a real label instead of falling back to the raw ruleId', () => {
    const groups = computeOpportunityGroups([], [finding({ pageUrl: '/a', ruleId: 'broken_page_status', severity: 'high' })]);
    expect(groups[0].issueLabel).toBe('Broken page');
  });

  it('shows unverified_claim_candidate in plain language, with the technical name small underneath (overseer polish, 2026-10-16)', () => {
    const groups = computeOpportunityGroups([], [finding({ pageUrl: '/a', ruleId: 'unverified_claim_candidate', severity: 'medium', agent: 'brand_specialist' })]);
    expect(groups[0].issueLabel).toBe('Claims Dex could not verify');
    expect(groups[0].technicalLabel).toBe('Unverified claim');
  });

  it('carries the real Finding id through to contributors so an opportunity can trace back to its persisted evidence', () => {
    const groups = computeOpportunityGroups([], [finding({ id: 'finding_abc', pageUrl: '/a', ruleId: 'missing_canonical', severity: 'medium' })]);
    expect(groups[0].contributors?.[0]?.id).toBe('finding_abc');
  });

  // Phase 2F S3: equal-pageCount groups must sort identically regardless of input order —
  // descending pageCount, then ascending by the group's own stable `key` as the tie-break.
  it('sorts equal-pageCount groups deterministically by key, regardless of input order', () => {
    const findingsAscending = [
      finding({ pageUrl: '/a', ruleId: 'missing_canonical', severity: 'medium' }),
      finding({ pageUrl: '/b', ruleId: 'missing_structured_data', severity: 'medium' }),
      finding({ pageUrl: '/c', ruleId: 'zero_internal_links', severity: 'medium' }),
    ];
    const groupsAscending = computeOpportunityGroups([], findingsAscending);
    const groupsDescending = computeOpportunityGroups([], [...findingsAscending].reverse());

    const keysAscending = groupsAscending.map((g) => g.key);
    const keysDescending = groupsDescending.map((g) => g.key);
    expect(keysAscending).toEqual(['finding:missing_canonical', 'finding:missing_structured_data', 'finding:zero_internal_links']);
    expect(keysDescending).toEqual(keysAscending);
  });

  it('includes a recommendation-derived group with proofLayer and severity both null', () => {
    const groups = computeOpportunityGroups([], [], new Date(), [{
      id: 'rec_1', topic: 'Pricing moves', confidenceLabel: 'verified_market_development',
      whyNow: 'A nearby competitor cut prices.', businessRelevance: 'Directly relevant to your market.',
      angle: 'What this means for you', websiteId: 'w1', pageUrl: null,
    }]);
    const recGroup = groups.find((g) => g.key.startsWith('recommendation:'));
    expect(recGroup?.proofLayer).toBeNull();
    expect(recGroup?.severity).toBeNull();
    expect(recGroup?.status).toBe('found');
    expect(recGroup?.recommendation?.confidenceLabel).toBe('verified_market_development');
  });
});
