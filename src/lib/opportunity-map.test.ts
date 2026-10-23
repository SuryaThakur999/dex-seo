import { describe, it, expect } from 'vitest';
import { computeOpportunityMapPoints } from './opportunity-map';
import type { OpportunityGroup } from './opportunity-board';

function group(overrides: Partial<OpportunityGroup> = {}): OpportunityGroup {
  return {
    key: 'finding:x',
    issueLabel: 'X',
    pageCount: 3,
    status: 'found',
    proofLayer: null,
    samplePageUrl: '/a',
    severity: 'medium',
    ...overrides,
  };
}

describe('computeOpportunityMapPoints', () => {
  it('maps real severity to a numeric impact rank', () => {
    const points = computeOpportunityMapPoints([group({ severity: 'high' }), group({ severity: 'low' })]);
    expect(points[0].impact).toBe(3);
    expect(points[1].impact).toBe(1);
  });

  it('uses the real pageCount as effort, never a fabricated estimate', () => {
    const points = computeOpportunityMapPoints([group({ pageCount: 7 })]);
    expect(points[0].effort).toBe(7);
  });

  it('leaves impact null for a group with no real severity, rather than guessing', () => {
    const points = computeOpportunityMapPoints([group({ severity: null })]);
    expect(points[0].impact).toBeNull();
  });
});
