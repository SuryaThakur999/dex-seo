import { describe, it, expect } from 'vitest';
import { describeEligibility, formatProvenance, formatStaleNotice } from './feedback-patterns-card';

describe('describeEligibility', () => {
  it('returns null when the account is eligible (0 needed)', () => {
    expect(describeEligibility(0)).toBeNull();
  });

  it('returns null when minEditsNeeded is negative (comfortably eligible)', () => {
    expect(describeEligibility(-2)).toBeNull();
  });

  it('states the exact shortfall when below threshold', () => {
    expect(describeEligibility(3)).toBe('Need at least 5 edited drafts — you have 2.');
  });

  it('states zero edits honestly when none exist yet', () => {
    expect(describeEligibility(5)).toBe('Need at least 5 edited drafts — you have 0.');
  });
});

describe('formatProvenance', () => {
  it('states the real edit count and a formatted date', () => {
    const result = formatProvenance(6, new Date('2026-09-15T00:00:00Z'));

    expect(result).toContain('6 edits');
    expect(result).toContain('2026');
  });

  it('states a single edit without a fabricated plural mismatch', () => {
    expect(formatProvenance(1, new Date('2026-09-15T00:00:00Z'))).toContain('1 edit');
    expect(formatProvenance(1, new Date('2026-09-15T00:00:00Z'))).not.toContain('1 edits');
  });
});

describe('formatStaleNotice', () => {
  it('states the exact new-edit count when it grew', () => {
    expect(formatStaleNotice(3)).toBe('3 new edits since this analysis — refresh?');
  });

  it('states a single new edit without a fabricated plural mismatch', () => {
    expect(formatStaleNotice(1)).toBe('1 new edit since this analysis — refresh?');
  });

  it('falls back to count-free phrasing when the fingerprint went stale without growth', () => {
    expect(formatStaleNotice(0)).toBe('New edits since this analysis — refresh?');
  });
});
