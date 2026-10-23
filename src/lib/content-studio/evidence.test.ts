import { describe, expect, it } from 'vitest';
import { readFindingEvidence } from './evidence';

describe('readFindingEvidence', () => {
  const snapshot = {
    kind: 'finding', findingId: 'finding_1', ruleId: 'missing_title',
    pageUrl: 'https://example.com', retrievedAt: '2026-10-13T12:00:00.000Z',
    evidence: { title: null }, limitations: 'Single page only',
  };

  it('reads the saved snapshot without replacing its evidence or limitations', () => {
    expect(readFindingEvidence(snapshot)).toBe(snapshot);
    expect(readFindingEvidence({ ...snapshot, limitations: null })).not.toBeNull();
  });

  it.each([null, [], {}, { ...snapshot, kind: 'source_action' }, { ...snapshot, ruleId: '' }, { ...snapshot, pageUrl: 42 }, { ...snapshot, limitations: undefined }])('rejects a missing or malformed snapshot: %j', (value) => {
    expect(readFindingEvidence(value)).toBeNull();
  });
});
