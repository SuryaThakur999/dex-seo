// Maps a scan's actual log-line messages (src/lib/run-scan.ts, src/lib/scan-worker.ts) onto the
// DEX MASTER DIRECTIVE's 5-stage vocabulary (Discover → Crawl → Analyze → Verify → Save). This is
// a display-only classifier over existing free-text messages — no schema change, no new column,
// and no stage is ever claimed unless a matching message actually exists. Unmatched messages
// classify as null rather than being forced into a stage, so nothing is fabricated.

export type ScanStage = 'discover' | 'crawl' | 'analyze' | 'verify' | 'save';

export const STAGE_ORDER: ScanStage[] = ['discover', 'crawl', 'analyze', 'verify', 'save'];

export const STAGE_LABELS: Record<ScanStage, string> = {
  discover: 'Discover',
  crawl: 'Crawl',
  analyze: 'Analyze',
  verify: 'Verify',
  save: 'Save',
};

// Exact prefix/shape matches only — no fuzzy heuristics. Each entry mirrors one real message
// shape from run-scan.ts/scan-worker.ts; if a message's wording changes there, it simply stops
// matching (falls back to null) instead of silently mislabeling.
const STAGE_PATTERNS: [ScanStage, RegExp][] = [
  ['discover', /^Starting scan for /],
  ['discover', /^Found \d+ pages? to check\.$/],
  ['crawl', /^Checking .+\.\.\.$/],
  ['analyze', /^SEO Specialist recorded /],
  ['analyze', /^GEO Specialist recorded /],
  ['analyze', /^Brand Specialist recorded /],
  ['analyze', /^Found \d+ page\(s\) worth fixing\.$/],
  ['analyze', /^Skipping /],
  ['analyze', /^Drafting a fix for /],
  ['verify', /^ProofLayer: /],
  ['verify', /^Couldn't process /],
  ['save', /^Scan complete — /],
];

export function classifyLogStage(message: string): ScanStage | null {
  for (const [stage, pattern] of STAGE_PATTERNS) {
    if (pattern.test(message)) return stage;
  }
  return null;
}

// Furthest stage any message in this job's log actually reached, in STAGE_ORDER. Used to
// highlight "reached" stages in the breadcrumb without claiming a stage the job never emitted
// a message for (e.g. a job that failed during Crawl never lights up Analyze/Verify/Save).
export function furthestStageReached(messages: string[]): ScanStage | null {
  let furthestIndex = -1;
  for (const message of messages) {
    const stage = classifyLogStage(message);
    if (!stage) continue;
    const index = STAGE_ORDER.indexOf(stage);
    if (index > furthestIndex) furthestIndex = index;
  }
  return furthestIndex === -1 ? null : STAGE_ORDER[furthestIndex];
}
