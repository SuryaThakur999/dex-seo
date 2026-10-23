import { describe, expect, it } from 'vitest';
import { buildCompetitorWatchItems, hasRealPriorChange } from './competitor-watch';

describe('hasRealPriorChange', () => {
  it('is false for a first-observation baseline row (priorContentHash: null)', () => {
    expect(hasRealPriorChange({ priorContentHash: null })).toBe(false);
  });
  it('is true once a prior hash exists', () => {
    expect(hasRealPriorChange({ priorContentHash: 'abc123' })).toBe(true);
  });
  it('is false for missing/malformed observedMetrics', () => {
    expect(hasRealPriorChange(null)).toBe(false);
    expect(hasRealPriorChange([])).toBe(false);
  });
});

describe('buildCompetitorWatchItems', () => {
  it('excludes baseline rows and maps the rest to CompetitorWatchItem', () => {
    const nameById = new Map([['c1', 'Acme Co']]);
    const evidence = [
      { id: 'e1', entityId: 'c1', canonicalUrl: 'https://acme.test', excerpt: 'New pricing.', retrievedAt: new Date('2026-10-14'), observedMetrics: { priorContentHash: 'old' } },
      { id: 'e2', entityId: 'c1', canonicalUrl: 'https://acme.test/first', excerpt: 'Baseline.', retrievedAt: new Date('2026-10-01'), observedMetrics: { priorContentHash: null } },
    ];
    const items = buildCompetitorWatchItems(evidence, nameById);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'e1', competitorName: 'Acme Co', canonicalUrl: 'https://acme.test', excerpt: 'New pricing.' });
    expect(items[0].retrievedAt).toBe('2026-10-14T00:00:00.000Z');
  });

  it('falls back to "Unknown competitor" for an entityId not in the map', () => {
    const items = buildCompetitorWatchItems(
      [{ id: 'e1', entityId: 'missing', canonicalUrl: 'https://x.test', excerpt: 'X', retrievedAt: new Date('2026-10-14'), observedMetrics: { priorContentHash: 'x' } }],
      new Map()
    );
    expect(items[0].competitorName).toBe('Unknown competitor');
  });
});
