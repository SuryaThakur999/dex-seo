import { describe, expect, it } from 'vitest';
import { normalizePageUrlForRescan, resolveFindingOutcome, computeVerifiedFixes } from './verified-on-rescan';

describe('normalizePageUrlForRescan', () => {
  it('lowercases the host but keeps path case', () => {
    expect(normalizePageUrlForRescan('https://Example.COM/Blog/Post')).toBe('https://example.com/Blog/Post');
  });

  it('treats the bare domain and / as the same page', () => {
    expect(normalizePageUrlForRescan('https://example.com')).toBe(normalizePageUrlForRescan('https://example.com/'));
  });

  it('strips a trailing slash on a non-root path', () => {
    expect(normalizePageUrlForRescan('https://example.com/blog/')).toBe(normalizePageUrlForRescan('https://example.com/blog'));
  });

  it('strips the fragment', () => {
    expect(normalizePageUrlForRescan('https://example.com/blog#section')).toBe(normalizePageUrlForRescan('https://example.com/blog'));
  });

  it('returns the raw input unchanged if it is not a parseable URL', () => {
    expect(normalizePageUrlForRescan('not-a-url')).toBe('not-a-url');
  });
});

describe('resolveFindingOutcome', () => {
  const base = { ruleStillFires: false, httpStatus: 200, blockedByRobots: false, noindex: false };

  it('returns fixed when the page is 200, reachable, indexable, and the rule no longer fires', () => {
    expect(resolveFindingOutcome(base)).toBe('fixed');
  });

  it('returns null (still found) when the rule still fires on a healthy page', () => {
    expect(resolveFindingOutcome({ ...base, ruleStillFires: true })).toBeNull();
  });

  it('returns excluded when robots.txt now disallows the page, even if the rule would still fire', () => {
    expect(resolveFindingOutcome({ ...base, ruleStillFires: true, blockedByRobots: true })).toBe('excluded');
  });

  it('returns excluded when the page is now noindex', () => {
    expect(resolveFindingOutcome({ ...base, ruleStillFires: true, noindex: true })).toBe('excluded');
  });

  it.each([401, 403, 404, 500, 503])('returns could_not_verify for HTTP %i', (httpStatus) => {
    expect(resolveFindingOutcome({ ...base, httpStatus })).toBe('could_not_verify');
  });

  it('returns could_not_verify when there is no status at all (timeout/network failure)', () => {
    expect(resolveFindingOutcome({ ...base, httpStatus: null })).toBe('could_not_verify');
  });

  it('never reports fixed for a page that could not be verified, even if the rule check was skipped', () => {
    expect(resolveFindingOutcome({ ...base, httpStatus: 500, ruleStillFires: false })).toBe('could_not_verify');
  });
});

describe('computeVerifiedFixes', () => {
  const now = new Date('2026-10-17T00:00:00Z');
  function finding(overrides: Partial<{ pageUrl: string; ruleId: string; retrievedAt: Date; resolvedAt: Date; resolution: 'fixed' | 'excluded'; evidence: unknown }> = {}) {
    return {
      pageUrl: 'https://example.com/blog', ruleId: 'missing_canonical',
      retrievedAt: new Date('2026-10-01T00:00:00Z'), resolvedAt: new Date('2026-10-05T00:00:00Z'),
      resolution: 'fixed' as const, evidence: { note: 'canonical tag found' },
      ...overrides,
    };
  }

  it('returns zero counts and no rule groups for an empty findings list', () => {
    const result = computeVerifiedFixes([], {}, now);
    expect(result.last30).toEqual({ count: 0, medianDaysToVerify: null });
    expect(result.last90).toEqual({ count: 0, medianDaysToVerify: null });
    expect(result.byRule).toEqual([]);
  });

  it('counts a fixed finding resolved within the last 30 and 90 days, with its days-to-verify as the median of 1', () => {
    const result = computeVerifiedFixes([finding()], {}, now);
    expect(result.last30.count).toBe(1);
    expect(result.last30.medianDaysToVerify).toBe(4);
    expect(result.last90.count).toBe(1);
  });

  it('excludes a resolution older than 90 days from both windows', () => {
    const result = computeVerifiedFixes([finding({ resolvedAt: new Date('2026-01-01T00:00:00Z') })], {}, now);
    expect(result.last30.count).toBe(0);
    expect(result.last90.count).toBe(0);
  });

  it('computes the median of an even number of day-diffs as the average of the two middle values', () => {
    const result = computeVerifiedFixes([
      finding({ retrievedAt: new Date('2026-10-01T00:00:00Z'), resolvedAt: new Date('2026-10-03T00:00:00Z') }), // 2 days
      finding({ retrievedAt: new Date('2026-10-01T00:00:00Z'), resolvedAt: new Date('2026-10-07T00:00:00Z') }), // 6 days
    ], {}, now);
    expect(result.last30.medianDaysToVerify).toBe(4);
  });

  it('groups rows by ruleId and gives excluded a fixed proof line regardless of its evidence', () => {
    const result = computeVerifiedFixes([
      finding({ ruleId: 'missing_canonical' }),
      finding({ ruleId: 'missing_canonical', pageUrl: 'https://example.com/other' }),
      finding({ ruleId: 'missing_structured_data', resolution: 'excluded', evidence: {} }),
    ], {}, now);
    expect(result.byRule.map((g) => g.ruleId).sort()).toEqual(['missing_canonical', 'missing_structured_data']);
    const canonicalGroup = result.byRule.find((g) => g.ruleId === 'missing_canonical');
    expect(canonicalGroup?.rows).toHaveLength(2);
    const excludedGroup = result.byRule.find((g) => g.ruleId === 'missing_structured_data');
    expect(excludedGroup?.rows[0].proofLine).toBe('Excluded from index on purpose');
  });

  it('returns null rejectedAsFalsePositiveRate for a rule with zero rejection-counted actions, not zero', () => {
    const result = computeVerifiedFixes([finding()], {}, now);
    expect(result.byRule[0].rejectedAsFalsePositiveRate).toBeNull();
  });

  it('computes rejectedAsFalsePositiveRate from the passed-in rejection counts', () => {
    const result = computeVerifiedFixes([finding()], { missing_canonical: { rejected: 1, total: 4 } }, now);
    expect(result.byRule[0].rejectedAsFalsePositiveRate).toBe(0.25);
  });
});
