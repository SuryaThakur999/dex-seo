import type { ScanResult } from './run-scan';
import type { ProofOutcome } from '@prisma/client';

export interface ActionForStats {
  status: string;
  tokenCost: number | null;
  guardResult: { outcome: string } | null;
}

export interface DashboardStats {
  pendingCount: number;
  guardCatches: number;
  tokensSpent: number;
}

export function computeDashboardStats(actions: ActionForStats[]): DashboardStats {
  let pendingCount = 0;
  let guardCatches = 0;
  let tokensSpent = 0;

  for (const action of actions) {
    if (action.status === 'pending') pendingCount += 1;
    const outcome = action.guardResult?.outcome;
    if (outcome === 'flag' || outcome === 'block') guardCatches += 1;
    tokensSpent += action.tokenCost ?? 0;
  }

  return { pendingCount, guardCatches, tokensSpent };
}

export interface GuardCounts {
  pass: number;
  flag: number;
  block: number;
}

const GUARD_OUTCOMES: readonly ProofOutcome[] = ['pass', 'flag', 'block'];

export function computeGuardBreakdown(actions: ActionForStats[]): GuardCounts {
  const counts: GuardCounts = { pass: 0, flag: 0, block: 0 };

  for (const action of actions) {
    const outcome = action.guardResult?.outcome;
    if (outcome && (GUARD_OUTCOMES as readonly string[]).includes(outcome)) {
      counts[outcome as ProofOutcome] += 1;
    }
  }

  return counts;
}

export interface ActivityDay {
  date: string;
  scans: number;
  drafts: number;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateKeysFor(days: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(toDateKey(d));
  }
  return keys;
}

export function computeActivitySeries(
  scans: { createdAt: Date }[],
  actions: { createdAt: Date }[],
  days: number,
  now: Date = new Date()
): ActivityDay[] {
  const buckets = new Map<string, ActivityDay>();
  for (const key of dateKeysFor(days, now)) {
    buckets.set(key, { date: key, scans: 0, drafts: 0 });
  }

  for (const scan of scans) {
    const bucket = buckets.get(toDateKey(scan.createdAt));
    if (bucket) bucket.scans += 1;
  }
  for (const action of actions) {
    const bucket = buckets.get(toDateKey(action.createdAt));
    if (bucket) bucket.drafts += 1;
  }

  return Array.from(buckets.values());
}

// `pagesAttempted` is absent on any resultSummary written before this field existed —
// that's genuinely unknown, not zero, so it stays undefined rather than defaulting.
export interface ParsedScanResult extends Omit<ScanResult, 'pagesAttempted'> {
  pagesAttempted: number | undefined;
}

export function parseScanResultSummary(json: unknown): ParsedScanResult | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.pagesScanned !== 'number') return null;

  return {
    pagesAttempted: typeof obj.pagesAttempted === 'number' ? obj.pagesAttempted : undefined,
    pagesScanned: obj.pagesScanned,
    pagesFlagged: typeof obj.pagesFlagged === 'number' ? obj.pagesFlagged : 0,
    draftsCreated: typeof obj.draftsCreated === 'number' ? obj.draftsCreated : 0,
    // Absent on any resultSummary written before Phase 1F's deterministic-remediation path
    // existed -- 0 is correct here too, same reasoning as draftsCreated/findingsCreated above.
    deterministicActionsCreated: typeof obj.deterministicActionsCreated === 'number' ? obj.deterministicActionsCreated : 0,
    findingsCreated: typeof obj.findingsCreated === 'number' ? obj.findingsCreated : 0,
    // Absent on any resultSummary written before Phase 2F S4's Marketing Memory extraction
    // existed -- 0 is correct, same reasoning as deterministicActionsCreated above.
    profileSuggestionsCreated: typeof obj.profileSuggestionsCreated === 'number' ? obj.profileSuggestionsCreated : 0,
    errors: Array.isArray(obj.errors) ? (obj.errors as { url: string; error: string }[]) : [],
    // Absent on any resultSummary written before this field existed -- unlike pagesAttempted
    // above, false is the correct (not merely convenient) default here: every scan run before
    // cancellation existed was, definitionally, never cancelled.
    cancelled: obj.cancelled === true,
  };
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatRelativeTime(date: Date): string {
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export function computeDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function splitByPeriod<T extends { createdAt: Date }>(
  items: T[],
  days: number,
  now: Date = new Date()
): { current: T[]; previous: T[] } {
  const currentStart = now.getTime() - days * 86400000;
  const previousStart = now.getTime() - 2 * days * 86400000;

  const current: T[] = [];
  const previous: T[] = [];
  for (const item of items) {
    const t = item.createdAt.getTime();
    if (t > currentStart && t <= now.getTime()) {
      current.push(item);
    } else if (t > previousStart && t <= currentStart) {
      previous.push(item);
    }
  }
  return { current, previous };
}

export interface DailyCount {
  date: string;
  value: number | null;
}

// `scanDays`, when given, marks which buckets had a scan job at all. A day outside that
// set renders as a gap (null) rather than a false "0 catches" / "0 tokens", since no scan
// ran means no measurement, not a measured zero.
function nullOutUnscannedBuckets(buckets: Map<string, DailyCount>, scanDays?: { createdAt: Date }[]): void {
  if (!scanDays) return;
  const scannedKeys = new Set(scanDays.map((scan) => toDateKey(scan.createdAt)));
  for (const [key, bucket] of buckets) {
    if (!scannedKeys.has(key)) bucket.value = null;
  }
}

export function computeGuardCatchSeries(
  actions: { createdAt: Date; guardResult: { outcome: string } | null }[],
  days: number,
  now: Date = new Date(),
  scanDays?: { createdAt: Date }[]
): DailyCount[] {
  const buckets = new Map<string, DailyCount>();
  for (const key of dateKeysFor(days, now)) {
    buckets.set(key, { date: key, value: 0 });
  }

  for (const action of actions) {
    const outcome = action.guardResult?.outcome;
    if (outcome !== 'flag' && outcome !== 'block') continue;
    const bucket = buckets.get(toDateKey(action.createdAt));
    if (bucket) bucket.value = (bucket.value ?? 0) + 1;
  }

  nullOutUnscannedBuckets(buckets, scanDays);
  return Array.from(buckets.values());
}

export function computeTokenSeries(
  actions: { createdAt: Date; tokenCost: number | null }[],
  days: number,
  now: Date = new Date(),
  scanDays?: { createdAt: Date }[]
): DailyCount[] {
  const buckets = new Map<string, DailyCount>();
  for (const key of dateKeysFor(days, now)) {
    buckets.set(key, { date: key, value: 0 });
  }

  for (const action of actions) {
    const bucket = buckets.get(toDateKey(action.createdAt));
    if (bucket) bucket.value = (bucket.value ?? 0) + (action.tokenCost ?? 0);
  }

  nullOutUnscannedBuckets(buckets, scanDays);
  return Array.from(buckets.values());
}

// Real per-day event counts (how many Findings/successful generations happened that day) —
// distinct from computeAuditFunnel's latest-scan snapshot, which exists specifically to
// avoid summing Finding re-creation across days. A day-by-day trend is legitimately about
// daily event counts, the same convention computeActivitySeries already uses for scans/drafts.
export function computeFindingsSeries(
  findings: { createdAt: Date }[],
  days: number,
  now: Date = new Date(),
  scanDays?: { createdAt: Date }[]
): DailyCount[] {
  const buckets = new Map<string, DailyCount>();
  for (const key of dateKeysFor(days, now)) buckets.set(key, { date: key, value: 0 });
  for (const finding of findings) {
    const bucket = buckets.get(toDateKey(finding.createdAt));
    if (bucket) bucket.value = (bucket.value ?? 0) + 1;
  }
  nullOutUnscannedBuckets(buckets, scanDays);
  return Array.from(buckets.values());
}

export function computeDraftSuccessSeries(
  actions: { createdAt: Date; generationStatus: string }[],
  days: number,
  now: Date = new Date(),
  scanDays?: { createdAt: Date }[]
): DailyCount[] {
  const buckets = new Map<string, DailyCount>();
  for (const key of dateKeysFor(days, now)) buckets.set(key, { date: key, value: 0 });
  for (const action of actions) {
    if (action.generationStatus !== 'succeeded') continue;
    const bucket = buckets.get(toDateKey(action.createdAt));
    if (bucket) bucket.value = (bucket.value ?? 0) + 1;
  }
  nullOutUnscannedBuckets(buckets, scanDays);
  return Array.from(buckets.values());
}

export function computeJobDelta(jobs: { status: string; resultSummary: unknown }[]): number | null {
  const completed = jobs.filter((job) => job.status === 'completed').slice(0, 2);
  if (completed.length < 2) return null;

  const latest = parseScanResultSummary(completed[0].resultSummary);
  const prior = parseScanResultSummary(completed[1].resultSummary);
  if (!latest || !prior) return null;

  return computeDelta(latest.pagesScanned, prior.pagesScanned);
}

export interface CategoryCount {
  category: string;
  count: number;
}

// Groups by the raw actionType so the count is only ever what actually ran — never a
// fabricated category the codebase doesn't produce yet.
export function computeFindingsByCategory(actions: { actionType: string }[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const action of actions) {
    counts.set(action.actionType, (counts.get(action.actionType) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

export interface PassRateTarget {
  passRate: number;
  target: number;
}

const PASS_RATE_TARGET = 90;

export function computePassRate(counts: GuardCounts): PassRateTarget {
  const total = counts.pass + counts.flag + counts.block;
  const passRate = total === 0 ? 100 : Math.round((counts.pass / total) * 100);
  return { passRate, target: PASS_RATE_TARGET };
}

export interface OutcomesSummary {
  measuredCount: number;
  winCount: number;
  totalImpressionsDelta: number;
  totalClicksDelta: number;
}

interface PerformanceSnapshot {
  impressions: number;
  clicks: number;
  ctr: number;
}

function asPerformanceSnapshot(value: unknown): PerformanceSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.impressions !== 'number' || typeof obj.clicks !== 'number') return null;
  return { impressions: obj.impressions, clicks: obj.clicks, ctr: typeof obj.ctr === 'number' ? obj.ctr : 0 };
}

export function computeOutcomesSummary(
  actions: { outcomeMeasuredAt: Date | null; baselinePerformance: unknown; outcomePerformance: unknown }[]
): OutcomesSummary {
  let measuredCount = 0;
  let winCount = 0;
  let totalImpressionsDelta = 0;
  let totalClicksDelta = 0;

  for (const action of actions) {
    if (!action.outcomeMeasuredAt) continue;
    const baseline = asPerformanceSnapshot(action.baselinePerformance);
    const outcome = asPerformanceSnapshot(action.outcomePerformance);
    if (!baseline || !outcome) continue;

    measuredCount += 1;
    const clicksDelta = outcome.clicks - baseline.clicks;
    const impressionsDelta = outcome.impressions - baseline.impressions;
    totalClicksDelta += clicksDelta;
    totalImpressionsDelta += impressionsDelta;
    if (clicksDelta > 0) winCount += 1;
  }

  return { measuredCount, winCount, totalImpressionsDelta, totalClicksDelta };
}

export interface FunnelStage {
  label: string;
  count: number;
  // Percent of the immediately preceding stage's count — never of an unfetchable
  // "discovered" denominator (no such real count exists anywhere in this codebase).
  pctOfPrevious: number | null;
}

// A snapshot of the most recent scan, not a range-summed funnel: Finding rows have no
// resolved-tracking (a still-open issue reappears every scan), so summing Finding counts
// across several days would double-count the same open issue once per scan. The latest
// scan's own numbers are the only honest cross-stage comparison.
export function computeAuditFunnel(input: {
  // Real field already tracked per scan (ScanResult.pagesAttempted) — every URL the crawler
  // tried to fetch, whether or not the fetch succeeded. Undefined only for scans recorded
  // before this field existed; the stage is then omitted rather than shown as a false 0.
  pagesAttempted?: number;
  pagesScanned: number;
  findingsCount: number;
  draftReadyCount: number;
  approvedCount: number;
}): FunnelStage[] {
  const stages: Omit<FunnelStage, 'pctOfPrevious'>[] = [
    ...(input.pagesAttempted !== undefined ? [{ label: 'Discovered', count: input.pagesAttempted }] : []),
    { label: 'Crawled', count: input.pagesScanned },
    { label: 'Findings', count: input.findingsCount },
    { label: 'Draft-ready', count: input.draftReadyCount },
    // All-time, unlike the three stages above (latest-scan only) — approvals happen
    // asynchronously after review, often well after the scan that surfaced them, so there is
    // no honest way to scope this to "the same batch." Labeled explicitly so the funnel never
    // reads as impossible growth (a real live-verification finding: an all-time Approved count
    // can exceed a failed latest scan's 0 Crawled/Findings/Draft-ready).
    { label: 'Approved (all-time)', count: input.approvedCount },
  ];
  return stages.map((stage, i) => ({
    ...stage,
    pctOfPrevious: i === 0 || stages[i - 1].count === 0 ? null : Math.round((stage.count / stages[i - 1].count) * 100),
  }));
}

export type CoverageDayStatus = 'completed' | 'running' | 'failed' | 'none';

export interface CoverageDay {
  date: string;
  status: CoverageDayStatus;
}

// One real ScanJob status per day — 'none' is an honest "no scan ran," never a fabricated
// zero. A day with more than one job takes the most severe/informative status (completed
// beats failed beats running, so a day that eventually succeeded shows as completed).
const STATUS_PRIORITY: Record<Exclude<CoverageDayStatus, 'none'>, number> = { completed: 3, failed: 2, running: 1 };

export function computeCoverageCalendar(
  jobs: { createdAt: Date; status: string }[],
  days: number,
  now: Date = new Date()
): CoverageDay[] {
  const buckets = new Map<string, CoverageDayStatus>();
  for (const key of dateKeysFor(days, now)) buckets.set(key, 'none');

  for (const job of jobs) {
    const key = toDateKey(job.createdAt);
    if (!buckets.has(key)) continue;
    if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'running') continue;
    const current = buckets.get(key)!;
    if (current === 'none' || STATUS_PRIORITY[job.status] > STATUS_PRIORITY[current]) {
      buckets.set(key, job.status);
    }
  }

  return dateKeysFor(days, now).map((date) => ({ date, status: buckets.get(date)! }));
}

// Generic named-key counter reused for both Finding.ruleId and Finding.agent breakdowns —
// same real-only-what-happened contract as computeFindingsByCategory.
function countByKey<T>(items: T[], key: (item: T) => string): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeFindingsByRule(findings: { ruleId: string }[]): CategoryCount[] {
  return countByKey(findings, (f) => f.ruleId);
}

export function computeFindingsByAgent(findings: { agent: string }[]): CategoryCount[] {
  return countByKey(findings, (f) => f.agent);
}

export interface GenerationHealth {
  ready: number;
  failed: number;
}

// Only the two real GenerationStatus enum values — no queued/rate-limited state exists
// anywhere in this codebase (no persistent queue, confirmed in Phase 0 of the master
// directive), so those buckets are never rendered rather than shown as a fabricated zero.
export function computeGenerationHealth(actions: { generationStatus: string }[]): GenerationHealth {
  let ready = 0;
  let failed = 0;
  for (const action of actions) {
    if (action.generationStatus === 'succeeded') ready += 1;
    else if (action.generationStatus === 'failed') failed += 1;
  }
  return { ready, failed };
}

// Average decidedAt-minus-createdAt, in minutes, per day among actions actually decided
// that day. A day with zero decisions is a real gap (null), not a false zero-minute review.
export function computeReviewTimeSeries(
  actions: { createdAt: Date; decidedAt: Date | null }[],
  days: number,
  now: Date = new Date()
): DailyCount[] {
  const sums = new Map<string, { total: number; n: number }>();
  for (const key of dateKeysFor(days, now)) sums.set(key, { total: 0, n: 0 });

  for (const action of actions) {
    if (!action.decidedAt) continue;
    const key = toDateKey(action.decidedAt);
    const bucket = sums.get(key);
    if (!bucket) continue;
    const minutes = (action.decidedAt.getTime() - action.createdAt.getTime()) / 60000;
    if (minutes < 0) continue;
    bucket.total += minutes;
    bucket.n += 1;
  }

  return dateKeysFor(days, now).map((date) => {
    const bucket = sums.get(date)!;
    return { date, value: bucket.n === 0 ? null : Math.round(bucket.total / bucket.n) };
  });
}

// Median (not mean) review time across all decided actions — resistant to one outlier
// review left open for days from skewing a single displayed headline number.
export function computeMedianReviewMinutes(actions: { createdAt: Date; decidedAt: Date | null }[]): number | null {
  const minutes = actions
    .filter((a): a is typeof a & { decidedAt: Date } => a.decidedAt !== null)
    .map((a) => (a.decidedAt.getTime() - a.createdAt.getTime()) / 60000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  if (minutes.length === 0) return null;
  const mid = Math.floor(minutes.length / 2);
  const median = minutes.length % 2 === 0 ? (minutes[mid - 1] + minutes[mid]) / 2 : minutes[mid];
  return Math.round(median);
}

// No $/token pricing constant exists anywhere in this codebase (checked before writing
// this) — tokens are the only real unit available, so this is what's shown, never a
// fabricated dollar figure.
export function computeTokensPerApprovedDraft(actions: { status: string; tokenCost: number | null }[]): number | null {
  // Real ActionStatus values only: pending/approved/edited/rejected — 'edited' still counts
  // as an accepted draft (the customer kept and used it, just changed the text first).
  const approved = actions.filter((a) => a.status === 'approved' || a.status === 'edited');
  if (approved.length === 0) return null;
  const total = approved.reduce((sum, a) => sum + (a.tokenCost ?? 0), 0);
  return Math.round(total / approved.length);
}

export interface OutcomeEvidenceRow {
  id: string;
  pageUrl: string;
  actionType: string;
  baselineCapturedAt: Date | null;
  outcomeMeasuredAt: Date;
  clicksDelta: number;
  impressionsDelta: number;
  // The baseline snapshot's own real clicks count — the actual sample the delta is computed
  // from, not an invented "confidence" label with thresholds this codebase has no basis for.
  baselineSampleClicks: number;
}

interface ActionForEvidenceRow {
  id: string;
  pageUrl: string;
  actionType: string;
  outcomeMeasuredAt: Date | null;
  baselineCapturedAt: Date | null;
  baselinePerformance: unknown;
  outcomePerformance: unknown;
}

// Same per-action math as computeOutcomesSummary, kept unaggregated for the Outcomes tab's
// evidence table — deliberately not summed into a sitewide figure (spec's own ban on that).
export function buildOutcomesEvidenceRows(actions: ActionForEvidenceRow[]): OutcomeEvidenceRow[] {
  const rows: OutcomeEvidenceRow[] = [];

  for (const action of actions) {
    if (!action.outcomeMeasuredAt) continue;
    const baseline = asPerformanceSnapshot(action.baselinePerformance);
    const outcome = asPerformanceSnapshot(action.outcomePerformance);
    if (!baseline || !outcome) continue;

    rows.push({
      id: action.id,
      pageUrl: action.pageUrl,
      actionType: action.actionType,
      baselineCapturedAt: action.baselineCapturedAt,
      outcomeMeasuredAt: action.outcomeMeasuredAt,
      clicksDelta: outcome.clicks - baseline.clicks,
      impressionsDelta: outcome.impressions - baseline.impressions,
      baselineSampleClicks: baseline.clicks,
    });
  }

  return rows.sort((a, b) => b.outcomeMeasuredAt.getTime() - a.outcomeMeasuredAt.getTime());
}

export interface MeasurementJourney {
  approved: number;
  baselineCaptured: number;
  observing: number;
  measured: number;
}

export const OBSERVATION_WINDOW_DAYS = 28;

// Real per-action stage counts — an action can only occupy the furthest stage its own
// timestamps confirm (no assumed progress). "Evidence ready" is not a separate count: the
// evidence PDF route works off any already-measured action, so it is identical to `measured`.
export function computeMeasurementJourney(
  actions: { status: string; baselineCapturedAt: Date | null; outcomeMeasuredAt: Date | null }[],
  now: Date = new Date()
): MeasurementJourney {
  let approved = 0;
  let baselineCaptured = 0;
  let observing = 0;
  let measured = 0;

  for (const action of actions) {
    if (action.status !== 'approved' && action.status !== 'edited') continue;
    approved += 1;
    if (!action.baselineCapturedAt) continue;
    baselineCaptured += 1;
    if (action.outcomeMeasuredAt) {
      measured += 1;
      continue;
    }
    const windowEnd = action.baselineCapturedAt.getTime() + OBSERVATION_WINDOW_DAYS * 86400000;
    if (now.getTime() < windowEnd) observing += 1;
  }

  return { approved, baselineCaptured, observing, measured };
}

export interface PendingMeasurement {
  id: string;
  pageUrl: string;
  expectedAt: Date;
}

// Only real rows: baseline captured, no outcome measured yet. `expectedAt` is a fixed
// baseline + 28 days, the same window the rest of this codebase already uses — not a guess.
export function computePendingMeasurements(
  actions: { id: string; pageUrl: string; baselineCapturedAt: Date | null; outcomeMeasuredAt: Date | null }[]
): PendingMeasurement[] {
  return actions
    .filter((a) => a.baselineCapturedAt && !a.outcomeMeasuredAt)
    .map((a) => ({
      id: a.id,
      pageUrl: a.pageUrl,
      expectedAt: new Date(a.baselineCapturedAt!.getTime() + OBSERVATION_WINDOW_DAYS * 86400000),
    }))
    .sort((a, b) => a.expectedAt.getTime() - b.expectedAt.getTime());
}
