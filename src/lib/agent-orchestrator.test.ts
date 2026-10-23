import { describe, it, expect } from 'vitest';
import { consolidateFindings, buildDecisionRecord, type OrchestratorFinding } from './agent-orchestrator';

function f(overrides: Partial<OrchestratorFinding> & { pageUrl: string; ruleId: string; agent: string }): OrchestratorFinding {
  return { id: `${overrides.ruleId}:${overrides.pageUrl}`, severity: 'low', evidence: {}, suggestedAction: 'Fix it.', limitations: null, ...overrides };
}

describe('buildDecisionRecord', () => {
  it('lists both participating agents and preserves evidence refs for each contributor', () => {
    const { consolidated } = consolidateFindings([
      f({ pageUrl: '/', ruleId: 'missing_structured_data', agent: 'seo_specialist' }),
      f({ pageUrl: '/', ruleId: 'missing_entity_markup', agent: 'geo_specialist' }),
    ]);
    const record = buildDecisionRecord(consolidated[0], new Date('2026-01-01T00:00:00Z'));

    expect(record.participatingAgents.sort()).toEqual(['geo_specialist', 'seo_specialist']);
    expect(record.evidenceRefs).toHaveLength(2);
    expect(record.resolutionRule).toBe('seo_geo_missing_structured_data');
    expect(record.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(record.reason).toBeTruthy();
  });

  it('deduplicates the agent list when the same agent contributed multiple pages under one rule', () => {
    const { consolidated } = consolidateFindings([
      f({ pageUrl: '/a', ruleId: 'missing_structured_data', agent: 'seo_specialist' }),
      f({ pageUrl: '/a', ruleId: 'missing_entity_markup', agent: 'geo_specialist' }),
      f({ pageUrl: '/b', ruleId: 'missing_structured_data', agent: 'seo_specialist' }),
      f({ pageUrl: '/b', ruleId: 'missing_entity_markup', agent: 'geo_specialist' }),
    ]);
    const record = buildDecisionRecord(consolidated[0]);
    expect(record.participatingAgents.sort()).toEqual(['geo_specialist', 'seo_specialist']);
    expect(record.evidenceRefs).toHaveLength(4);
  });

  it('builds the full council fields with honest real-population values', () => {
    const { consolidated } = consolidateFindings([
      f({ pageUrl: '/', ruleId: 'missing_structured_data', agent: 'seo_specialist', severity: 'medium', suggestedAction: 'Add JSON-LD.', limitations: 'Homepage only.' }),
      f({ pageUrl: '/', ruleId: 'missing_entity_markup', agent: 'geo_specialist', severity: 'high', suggestedAction: 'Add Organization schema.', limitations: null }),
    ]);
    const record = buildDecisionRecord(consolidated[0], new Date('2026-01-01T00:00:00Z'));

    expect(record.recommendations).toHaveLength(2);
    expect(record.recommendations.map((r) => r.agent).sort()).toEqual(['geo_specialist', 'seo_specialist']);
    expect(record.recommendations.find((r) => r.agent === 'seo_specialist')).toEqual({
      agent: 'seo_specialist',
      ruleId: 'missing_structured_data',
      suggestedAction: 'Add JSON-LD.',
      limitations: 'Homepage only.',
    });
    expect(record.agreement).toBe('agreed');
    expect(record.disagreement).toBeNull();
    // geo_specialist's finding is 'high' severity, seo_specialist's is 'medium' — the higher one wins.
    expect(record.finalRecommendation).toBe('Add Organization schema.');
    expect(record.confidence).toBe('high');
    expect(record.limitations).toBe('Homepage only.');
    expect(record.owner).toBe('not_applicable');
    expect(record.measurementPlan).toContain('28');
  });

  it('joins limitations from both contributors when both are present, and is null when neither has one', () => {
    const bothNull = consolidateFindings([
      f({ pageUrl: '/', ruleId: 'missing_structured_data', agent: 'seo_specialist', limitations: null }),
      f({ pageUrl: '/', ruleId: 'missing_entity_markup', agent: 'geo_specialist', limitations: null }),
    ]).consolidated;
    expect(buildDecisionRecord(bothNull[0]).limitations).toBeNull();

    const bothPresent = consolidateFindings([
      f({ pageUrl: '/', ruleId: 'missing_structured_data', agent: 'seo_specialist', limitations: 'A.' }),
      f({ pageUrl: '/', ruleId: 'missing_entity_markup', agent: 'geo_specialist', limitations: 'B.' }),
    ]).consolidated;
    expect(buildDecisionRecord(bothPresent[0]).limitations).toBe('A. B.');
  });
});
