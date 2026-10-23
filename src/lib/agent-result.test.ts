import { describe, it, expect } from 'vitest';
import { normalizeFinding } from './agent-result';

function baseFinding(overrides: Partial<Parameters<typeof normalizeFinding>[0]> = {}) {
  return {
    id: 'f1',
    agent: 'seo_specialist',
    ruleId: 'missing_canonical',
    ruleVersion: 'v1',
    pageUrl: 'https://example.com/',
    severity: 'medium' as const,
    confidence: 'high',
    suggestedAction: 'Add a canonical tag.',
    limitations: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('normalizeFinding', () => {
  it('carries every real field through unchanged', () => {
    const result = normalizeFinding(baseFinding());
    expect(result.findingId).toBe('f1');
    expect(result.agentId).toBe('seo_specialist');
    expect(result.ruleId).toBe('missing_canonical');
    expect(result.affectedUrl).toBe('https://example.com/');
    expect(result.severity).toBe('medium');
    expect(result.recommendedAction).toBe('Add a canonical tag.');
  });

  it('marks language and market as honestly not_evaluated, never a guessed locale', () => {
    const result = normalizeFinding(baseFinding());
    expect(result.language).toBe('not_evaluated');
    expect(result.market).toBe('not_evaluated');
  });

  it('leaves citations empty and model/prompt version unset — no fabricated provenance', () => {
    const result = normalizeFinding(baseFinding());
    expect(result.citations).toEqual([]);
    expect(result.modelVersion).toBeUndefined();
    expect(result.promptVersion).toBeUndefined();
  });

  it('derives confidenceBasis from whether the finding has real limitations text', () => {
    const withLimitations = normalizeFinding(baseFinding({ limitations: 'Pattern-matched, not verified.' }));
    const without = normalizeFinding(baseFinding({ limitations: null }));
    expect(withLimitations.confidenceBasis).toMatch(/pattern/i);
    expect(without.confidenceBasis).toMatch(/deterministic/i);
  });

  it('uses evidenceRef equal to the real Finding id — a stable identity, not a separate lookup', () => {
    const result = normalizeFinding(baseFinding({ id: 'finding_abc' }));
    expect(result.evidenceRef).toBe('finding_abc');
  });

  it('prefers retrievedAt over createdAt for the timestamp when both exist', () => {
    const retrievedAt = new Date('2026-02-01T00:00:00Z');
    const result = normalizeFinding(baseFinding({ retrievedAt, createdAt: new Date('2026-01-01T00:00:00Z') }));
    expect(result.timestamp).toBe(retrievedAt.toISOString());
  });
});
