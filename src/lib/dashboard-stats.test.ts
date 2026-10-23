import { describe, it, expect } from 'vitest';
import {
  computeDashboardStats,
  computeGuardBreakdown,
  computeActivitySeries,
  parseScanResultSummary,
  formatRelativeTime,
  computeDelta,
  splitByPeriod,
  computeGuardCatchSeries,
  computeTokenSeries,
  computeJobDelta,
  computePassRate,
  computeOutcomesSummary,
  buildOutcomesEvidenceRows,
  computeFindingsByCategory,
  computeAuditFunnel,
  computeCoverageCalendar,
  computeFindingsByRule,
  computeFindingsByAgent,
  computeGenerationHealth,
  computeReviewTimeSeries,
  computeTokensPerApprovedDraft,
  computeFindingsSeries,
  computeDraftSuccessSeries,
  computeMedianReviewMinutes,
  formatMinutes,
  computeMeasurementJourney,
  computePendingMeasurements,
} from './dashboard-stats';

describe('computeDashboardStats', () => {
  it('counts pending actions, guard catches, and token spend', () => {
    const actions = [
      { status: 'pending', tokenCost: 10, guardResult: { outcome: 'pass' } },
      { status: 'pending', tokenCost: 20, guardResult: { outcome: 'flag' } },
      { status: 'approved', tokenCost: 15, guardResult: { outcome: 'block' } },
      { status: 'approved', tokenCost: null, guardResult: null },
    ];
    expect(computeDashboardStats(actions)).toEqual({ pendingCount: 2, guardCatches: 2, tokensSpent: 45 });
  });

  it('returns zeros for an empty action list', () => {
    expect(computeDashboardStats([])).toEqual({ pendingCount: 0, guardCatches: 0, tokensSpent: 0 });
  });
});

describe('computeGuardBreakdown', () => {
  it('counts each outcome bucket and ignores actions with no guard result', () => {
    const actions = [
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'pass' } },
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'pass' } },
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'flag' } },
      { status: 'pending', tokenCost: null, guardResult: { outcome: 'block' } },
      { status: 'pending', tokenCost: null, guardResult: null },
    ];
    expect(computeGuardBreakdown(actions)).toEqual({ pass: 2, flag: 1, block: 1 });
  });

  it('returns zeros for an empty action list', () => {
    expect(computeGuardBreakdown([])).toEqual({ pass: 0, flag: 0, block: 0 });
  });
});

describe('computeActivitySeries', () => {
  it('buckets scans and actions by day, zero-filled, oldest first', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const scans = [
      { createdAt: new Date('2026-09-04T09:00:00.000Z') },
      { createdAt: new Date('2026-09-02T09:00:00.000Z') },
    ];
    const actions = [
      { createdAt: new Date('2026-09-04T10:00:00.000Z') },
      { createdAt: new Date('2026-09-04T11:00:00.000Z') },
    ];
    const series = computeActivitySeries(scans, actions, 3, today);
    expect(series).toEqual([
      { date: '2026-09-02', scans: 1, drafts: 0 },
      { date: '2026-09-03', scans: 0, drafts: 0 },
      { date: '2026-09-04', scans: 1, drafts: 2 },
    ]);
  });

  it('returns an all-zero series when there is no activity', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const series = computeActivitySeries([], [], 2, today);
    expect(series).toEqual([
      { date: '2026-09-03', scans: 0, drafts: 0 },
      { date: '2026-09-04', scans: 0, drafts: 0 },
    ]);
  });
});

describe('parseScanResultSummary', () => {
  it('parses a valid scan result JSON blob', () => {
    const json = {
      pagesScanned: 12,
      pagesFlagged: 4,
      draftsCreated: 3,
      deterministicActionsCreated: 1,
      findingsCreated: 2,
      profileSuggestionsCreated: 1,
      errors: [],
      cancelled: false,
    };
    expect(parseScanResultSummary(json)).toEqual(json);
  });

  it('returns null for null, non-object, or missing pagesScanned', () => {
    expect(parseScanResultSummary(null)).toBeNull();
    expect(parseScanResultSummary('not an object')).toBeNull();
    expect(parseScanResultSummary({})).toBeNull();
  });

  it('defaults missing optional fields to zero/empty', () => {
    expect(parseScanResultSummary({ pagesScanned: 5 })).toEqual({
      pagesScanned: 5,
      pagesFlagged: 0,
      draftsCreated: 0,
      deterministicActionsCreated: 0,
      findingsCreated: 0,
      profileSuggestionsCreated: 0,
      errors: [],
      cancelled: false,
    });
  });
});

describe('formatRelativeTime', () => {
  it('returns "just now" for a timestamp under a minute old', () => {
    expect(formatRelativeTime(new Date(Date.now() - 10 * 1000))).toBe('just now');
  });

  it('formats minutes ago', () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60000))).toBe('5m ago');
  });

  it('formats hours ago', () => {
    expect(formatRelativeTime(new Date(Date.now() - 2 * 60 * 60000))).toBe('2h ago');
  });

  it('formats days ago', () => {
    expect(formatRelativeTime(new Date(Date.now() - 3 * 24 * 60 * 60000))).toBe('3d ago');
  });
});

describe('computeDelta', () => {
  it('returns positive percent change', () => {
    expect(computeDelta(120, 100)).toBe(20);
  });

  it('returns negative percent change', () => {
    expect(computeDelta(80, 100)).toBe(-20);
  });

  it('returns null when previous is zero, regardless of current', () => {
    expect(computeDelta(10, 0)).toBeNull();
    expect(computeDelta(0, 0)).toBeNull();
  });
});

describe('splitByPeriod', () => {
  it('splits items into current window and the window before it, dropping anything older', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const items = [
      { id: 'a', createdAt: new Date('2026-09-06T00:00:00.000Z') }, // 0 days ago -> current
      { id: 'b', createdAt: new Date('2026-08-30T12:00:00.000Z') }, // 7 days ago -> boundary, previous
      { id: 'c', createdAt: new Date('2026-08-28T00:00:00.000Z') }, // 9 days ago -> previous
      { id: 'd', createdAt: new Date('2026-08-20T00:00:00.000Z') }, // 17 days ago -> dropped
    ];
    const result = splitByPeriod(items, 7, now);
    expect(result.current.map((i) => i.id)).toEqual(['a']);
    expect(result.previous.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('returns empty arrays for no items', () => {
    expect(splitByPeriod([], 7, new Date())).toEqual({ current: [], previous: [] });
  });
});

describe('computeGuardCatchSeries', () => {
  it('buckets flag+block outcomes by day and ignores pass', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const actions = [
      { createdAt: new Date('2026-09-04T09:00:00.000Z'), guardResult: { outcome: 'flag' } },
      { createdAt: new Date('2026-09-04T10:00:00.000Z'), guardResult: { outcome: 'block' } },
      { createdAt: new Date('2026-09-04T11:00:00.000Z'), guardResult: { outcome: 'pass' } },
      { createdAt: new Date('2026-09-03T09:00:00.000Z'), guardResult: { outcome: 'flag' } },
    ];
    expect(computeGuardCatchSeries(actions, 2, today)).toEqual([
      { date: '2026-09-03', value: 1 },
      { date: '2026-09-04', value: 2 },
    ]);
  });

  it('renders a day with no scan job as null instead of a measured zero', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const actions = [{ createdAt: new Date('2026-09-04T09:00:00.000Z'), guardResult: { outcome: 'flag' } }];
    const scanDays = [{ createdAt: new Date('2026-09-04T08:00:00.000Z') }];
    expect(computeGuardCatchSeries(actions, 2, today, scanDays)).toEqual([
      { date: '2026-09-03', value: null },
      { date: '2026-09-04', value: 1 },
    ]);
  });
});

describe('computeTokenSeries', () => {
  it('sums tokenCost by day, treating null as zero', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    const actions = [
      { createdAt: new Date('2026-09-04T09:00:00.000Z'), tokenCost: 10 },
      { createdAt: new Date('2026-09-04T10:00:00.000Z'), tokenCost: 20 },
      { createdAt: new Date('2026-09-04T11:00:00.000Z'), tokenCost: null },
    ];
    expect(computeTokenSeries(actions, 1, today)).toEqual([{ date: '2026-09-04', value: 30 }]);
  });

  it('renders a day with no scan job as null instead of a measured zero', () => {
    const today = new Date('2026-09-04T12:00:00.000Z');
    expect(computeTokenSeries([], 1, today, [])).toEqual([{ date: '2026-09-04', value: null }]);
  });
});

describe('buildOutcomesEvidenceRows', () => {
  it('maps measured actions to rows without summing across them', () => {
    const actions = [
      {
        id: 'a1',
        pageUrl: '/a',
        actionType: 'meta_description',
        outcomeMeasuredAt: new Date('2026-09-01T00:00:00.000Z'),
        baselineCapturedAt: new Date('2026-08-01T00:00:00.000Z'),
        baselinePerformance: { impressions: 100, clicks: 10, ctr: 0.1 },
        outcomePerformance: { impressions: 150, clicks: 18, ctr: 0.12 },
      },
      {
        id: 'a2',
        pageUrl: '/b',
        actionType: 'meta_description',
        outcomeMeasuredAt: null,
        baselineCapturedAt: null,
        baselinePerformance: null,
        outcomePerformance: null,
      },
    ];
    expect(buildOutcomesEvidenceRows(actions)).toEqual([
      {
        id: 'a1',
        pageUrl: '/a',
        actionType: 'meta_description',
        baselineCapturedAt: new Date('2026-08-01T00:00:00.000Z'),
        outcomeMeasuredAt: new Date('2026-09-01T00:00:00.000Z'),
        clicksDelta: 8,
        impressionsDelta: 50,
        baselineSampleClicks: 10,
      },
    ]);
  });
});

describe('computeJobDelta', () => {
  it('computes percent change in pagesScanned between the two most recent completed jobs', () => {
    const jobs = [
      { status: 'completed', resultSummary: { pagesScanned: 12, pagesFlagged: 0, draftsCreated: 0, errors: [] } },
      { status: 'failed', resultSummary: null },
      { status: 'completed', resultSummary: { pagesScanned: 10, pagesFlagged: 0, draftsCreated: 0, errors: [] } },
    ];
    expect(computeJobDelta(jobs)).toBe(20);
  });

  it('returns null with fewer than two completed jobs', () => {
    expect(computeJobDelta([{ status: 'completed', resultSummary: { pagesScanned: 12, pagesFlagged: 0, draftsCreated: 0, errors: [] } }])).toBeNull();
    expect(computeJobDelta([])).toBeNull();
  });
});

describe('computePassRate', () => {
  it('computes the pass rate as a percentage of total checks', () => {
    expect(computePassRate({ pass: 18, flag: 1, block: 1 })).toEqual({ passRate: 90, target: 90 });
  });

  it('returns 100% when there are no checks yet', () => {
    expect(computePassRate({ pass: 0, flag: 0, block: 0 })).toEqual({ passRate: 100, target: 90 });
  });

  it('rounds to the nearest whole percent', () => {
    expect(computePassRate({ pass: 2, flag: 1, block: 0 })).toEqual({ passRate: 67, target: 90 });
  });
});

describe('computeOutcomesSummary', () => {
  it('ignores actions that have not been measured yet', () => {
    const actions = [
      { outcomeMeasuredAt: null, baselinePerformance: { impressions: 10, clicks: 1, ctr: 0.1 }, outcomePerformance: null },
    ];
    expect(computeOutcomesSummary(actions)).toEqual({
      measuredCount: 0,
      winCount: 0,
      totalImpressionsDelta: 0,
      totalClicksDelta: 0,
    });
  });

  it('aggregates deltas and counts wins across measured actions', () => {
    const actions = [
      {
        outcomeMeasuredAt: new Date('2026-02-01'),
        baselinePerformance: { impressions: 100, clicks: 5, ctr: 0.05 },
        outcomePerformance: { impressions: 150, clicks: 9, ctr: 0.06 },
      },
      {
        outcomeMeasuredAt: new Date('2026-02-02'),
        baselinePerformance: { impressions: 50, clicks: 4, ctr: 0.08 },
        outcomePerformance: { impressions: 40, clicks: 2, ctr: 0.05 },
      },
    ];
    expect(computeOutcomesSummary(actions)).toEqual({
      measuredCount: 2,
      winCount: 1,
      totalImpressionsDelta: 40,
      totalClicksDelta: 2,
    });
  });
});

describe('computeFindingsByCategory', () => {
  it('groups by the real actionType, most-common first', () => {
    const actions = [
      { actionType: 'meta_description' },
      { actionType: 'meta_description' },
      { actionType: 'title_tag' },
    ];
    expect(computeFindingsByCategory(actions)).toEqual([
      { category: 'meta_description', count: 2 },
      { category: 'title_tag', count: 1 },
    ]);
  });

  it('returns an empty list rather than a fabricated category', () => {
    expect(computeFindingsByCategory([])).toEqual([]);
  });
});

describe('computeAuditFunnel', () => {
  it('computes each stage as a percent of the immediately preceding stage', () => {
    const stages = computeAuditFunnel({ pagesScanned: 10, findingsCount: 8, draftReadyCount: 4, approvedCount: 2 });
    expect(stages).toEqual([
      { label: 'Crawled', count: 10, pctOfPrevious: null },
      { label: 'Findings', count: 8, pctOfPrevious: 80 },
      { label: 'Draft-ready', count: 4, pctOfPrevious: 50 },
      { label: 'Approved (all-time)', count: 2, pctOfPrevious: 50 },
    ]);
  });

  it('adds a real Discovered stage first when pagesAttempted is known', () => {
    const stages = computeAuditFunnel({
      pagesAttempted: 20,
      pagesScanned: 10,
      findingsCount: 8,
      draftReadyCount: 4,
      approvedCount: 2,
    });
    expect(stages[0]).toEqual({ label: 'Discovered', count: 20, pctOfPrevious: null });
    expect(stages[1]).toEqual({ label: 'Crawled', count: 10, pctOfPrevious: 50 });
  });

  it('omits Discovered rather than showing a false 0 when pagesAttempted is unknown', () => {
    const stages = computeAuditFunnel({ pagesScanned: 10, findingsCount: 8, draftReadyCount: 4, approvedCount: 2 });
    expect(stages.map((s) => s.label)).not.toContain('Discovered');
  });

  it('does not divide by zero when a preceding stage is empty', () => {
    const stages = computeAuditFunnel({ pagesScanned: 0, findingsCount: 0, draftReadyCount: 0, approvedCount: 0 });
    expect(stages.every((s) => s.pctOfPrevious === null || s.pctOfPrevious === 0)).toBe(true);
    expect(stages[1].pctOfPrevious).toBeNull();
  });
});

describe('computeCoverageCalendar', () => {
  const now = new Date('2026-09-14T12:00:00Z');

  it('marks a day with no scan job as "none", not a fabricated zero', () => {
    const days = computeCoverageCalendar([], 3, now);
    expect(days.every((d) => d.status === 'none')).toBe(true);
    expect(days).toHaveLength(3);
  });

  it('prefers completed over failed over running for the same day', () => {
    const jobs = [
      { createdAt: new Date('2026-09-14T01:00:00Z'), status: 'running' },
      { createdAt: new Date('2026-09-14T02:00:00Z'), status: 'failed' },
      { createdAt: new Date('2026-09-14T03:00:00Z'), status: 'completed' },
    ];
    const days = computeCoverageCalendar(jobs, 1, now);
    expect(days).toEqual([{ date: '2026-09-14', status: 'completed' }]);
  });

  it('ignores a job status outside the known set rather than crashing', () => {
    const days = computeCoverageCalendar([{ createdAt: now, status: 'queued' }], 1, now);
    expect(days).toEqual([{ date: '2026-09-14', status: 'none' }]);
  });
});

describe('computeFindingsByRule and computeFindingsByAgent', () => {
  it('counts real ruleId occurrences, most frequent first', () => {
    const findings = [{ ruleId: 'missing_canonical' }, { ruleId: 'missing_canonical' }, { ruleId: 'zero_internal_links' }];
    expect(computeFindingsByRule(findings)).toEqual([
      { category: 'missing_canonical', count: 2 },
      { category: 'zero_internal_links', count: 1 },
    ]);
  });

  it('counts real agent occurrences, most frequent first', () => {
    const findings = [{ agent: 'seo_specialist' }, { agent: 'geo_specialist' }, { agent: 'seo_specialist' }];
    expect(computeFindingsByAgent(findings)).toEqual([
      { category: 'seo_specialist', count: 2 },
      { category: 'geo_specialist', count: 1 },
    ]);
  });
});

describe('computeGenerationHealth', () => {
  it('counts only the two real generationStatus values', () => {
    const actions = [{ generationStatus: 'succeeded' }, { generationStatus: 'succeeded' }, { generationStatus: 'failed' }];
    expect(computeGenerationHealth(actions)).toEqual({ ready: 2, failed: 1 });
  });

  it('returns zeros for an empty list', () => {
    expect(computeGenerationHealth([])).toEqual({ ready: 0, failed: 0 });
  });
});

describe('computeReviewTimeSeries', () => {
  const now = new Date('2026-09-14T12:00:00Z');

  it('averages review minutes per day among actions decided that day', () => {
    const actions = [
      { createdAt: new Date('2026-09-14T01:00:00Z'), decidedAt: new Date('2026-09-14T02:00:00Z') }, // 60 min
      { createdAt: new Date('2026-09-14T01:00:00Z'), decidedAt: new Date('2026-09-14T04:00:00Z') }, // 180 min
    ];
    const days = computeReviewTimeSeries(actions, 1, now);
    expect(days).toEqual([{ date: '2026-09-14', value: 120 }]);
  });

  it('leaves a day with no decisions as a real gap, not zero', () => {
    const days = computeReviewTimeSeries([], 1, now);
    expect(days).toEqual([{ date: '2026-09-14', value: null }]);
  });

  it('ignores an undecided action (decidedAt null)', () => {
    const days = computeReviewTimeSeries([{ createdAt: now, decidedAt: null }], 1, now);
    expect(days).toEqual([{ date: '2026-09-14', value: null }]);
  });
});

describe('computeTokensPerApprovedDraft', () => {
  it('averages token cost across approved and edited actions only', () => {
    const actions = [
      { status: 'approved', tokenCost: 100 },
      { status: 'edited', tokenCost: 200 },
      { status: 'pending', tokenCost: 9999 },
      { status: 'rejected', tokenCost: 9999 },
    ];
    expect(computeTokensPerApprovedDraft(actions)).toBe(150);
  });

  it('returns null rather than a fabricated cost when nothing is approved yet', () => {
    expect(computeTokensPerApprovedDraft([{ status: 'pending', tokenCost: 500 }])).toBeNull();
  });
});

describe('computeFindingsSeries and computeDraftSuccessSeries', () => {
  const now = new Date('2026-09-14T12:00:00Z');

  it('counts real findings per day', () => {
    const findings = [{ createdAt: new Date('2026-09-14T01:00:00Z') }, { createdAt: new Date('2026-09-14T02:00:00Z') }];
    expect(computeFindingsSeries(findings, 1, now)).toEqual([{ date: '2026-09-14', value: 2 }]);
  });

  it('counts only successful generations per day', () => {
    const actions = [
      { createdAt: now, generationStatus: 'succeeded' },
      { createdAt: now, generationStatus: 'failed' },
      { createdAt: now, generationStatus: 'succeeded' },
    ];
    expect(computeDraftSuccessSeries(actions, 1, now)).toEqual([{ date: '2026-09-14', value: 2 }]);
  });

  it('nulls out a day with no scan when scanDays is given', () => {
    expect(computeFindingsSeries([], 1, now, [])).toEqual([{ date: '2026-09-14', value: null }]);
  });
});

describe('computeMedianReviewMinutes', () => {
  it('returns the true median, not the mean, so one outlier cannot dominate', () => {
    const base = new Date('2026-09-14T00:00:00Z');
    const actions = [
      { createdAt: base, decidedAt: new Date(base.getTime() + 10 * 60000) },
      { createdAt: base, decidedAt: new Date(base.getTime() + 20 * 60000) },
      { createdAt: base, decidedAt: new Date(base.getTime() + 10000 * 60000) }, // huge outlier
    ];
    expect(computeMedianReviewMinutes(actions)).toBe(20);
  });

  it('returns null rather than a fabricated time when nothing has been decided', () => {
    expect(computeMedianReviewMinutes([{ createdAt: new Date(), decidedAt: null }])).toBeNull();
  });
});

describe('computeMeasurementJourney', () => {
  const now = new Date('2026-09-14T00:00:00Z');

  it('counts each action at the furthest real stage its own timestamps confirm', () => {
    const actions = [
      { status: 'approved', baselineCapturedAt: null, outcomeMeasuredAt: null }, // approved only
      { status: 'approved', baselineCapturedAt: new Date('2026-09-01T00:00:00Z'), outcomeMeasuredAt: null }, // observing (13 days in)
      { status: 'approved', baselineCapturedAt: new Date('2026-01-01T00:00:00Z'), outcomeMeasuredAt: null }, // window passed, not yet measured
      { status: 'approved', baselineCapturedAt: new Date('2026-01-01T00:00:00Z'), outcomeMeasuredAt: new Date('2026-02-01T00:00:00Z') }, // measured
      { status: 'pending', baselineCapturedAt: null, outcomeMeasuredAt: null }, // not approved, excluded entirely
    ];
    expect(computeMeasurementJourney(actions, now)).toEqual({ approved: 4, baselineCaptured: 3, observing: 1, measured: 1 });
  });

  it('counts edited the same as approved', () => {
    expect(computeMeasurementJourney([{ status: 'edited', baselineCapturedAt: null, outcomeMeasuredAt: null }], now)).toEqual({
      approved: 1,
      baselineCaptured: 0,
      observing: 0,
      measured: 0,
    });
  });

  it('returns all zeros for an empty list', () => {
    expect(computeMeasurementJourney([], now)).toEqual({ approved: 0, baselineCaptured: 0, observing: 0, measured: 0 });
  });
});

describe('computePendingMeasurements', () => {
  it('lists only baseline-captured, not-yet-measured actions, soonest expected first', () => {
    const actions = [
      { id: 'a1', pageUrl: '/a', baselineCapturedAt: new Date('2026-09-05T00:00:00Z'), outcomeMeasuredAt: null },
      { id: 'a2', pageUrl: '/b', baselineCapturedAt: new Date('2026-09-01T00:00:00Z'), outcomeMeasuredAt: null },
      { id: 'a3', pageUrl: '/c', baselineCapturedAt: null, outcomeMeasuredAt: null },
      { id: 'a4', pageUrl: '/d', baselineCapturedAt: new Date('2026-01-01T00:00:00Z'), outcomeMeasuredAt: new Date('2026-02-01T00:00:00Z') },
    ];
    const result = computePendingMeasurements(actions);
    expect(result.map((r) => r.id)).toEqual(['a2', 'a1']);
    expect(result[0].expectedAt).toEqual(new Date('2026-09-29T00:00:00Z'));
  });

  it('returns an empty list rather than a fabricated date when nothing is pending', () => {
    expect(computePendingMeasurements([])).toEqual([]);
  });
});

describe('formatMinutes', () => {
  it('formats under an hour as minutes only', () => {
    expect(formatMinutes(45)).toBe('45m');
  });

  it('formats an exact hour with no trailing 0m', () => {
    expect(formatMinutes(120)).toBe('2h');
  });

  it('formats hours plus remaining minutes', () => {
    expect(formatMinutes(258)).toBe('4h 18m');
  });
});
