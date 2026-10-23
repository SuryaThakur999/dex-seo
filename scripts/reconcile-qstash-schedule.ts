#!/usr/bin/env -S npx tsx
/**
 * Phase 1E, Part F: idempotent, least-privilege reconciliation for Dex-owned QStash schedules.
 *
 * The incident this exists to prevent: a stale schedule (created before a route was renamed or
 * a signing key rotated) kept delivering to a dead or wrong destination, and nothing noticed
 * until the queue silently stopped draining. Reconciliation makes "is the right schedule the
 * only one running" a repeatable, auditable check instead of a one-off manual fix.
 *
 * Identification: this repo's schedules predate any labeling convention, so a schedule is
 * identified as Dex-owned by BOTH its destination path (one of DEX_OWNED_ROUTES below) AND its
 * HTTP method (GET, matching those routes' handlers) -- destination alone is not proof of
 * ownership (the directive's own requirement). Every schedule this script creates going forward
 * carries an explicit `Upstash-Label` (see DEX_SCHEDULE_LABEL) so future runs have the stronger
 * signal; existing pre-label schedules fall back to the path+method match until they're
 * recreated under a label.
 *
 * Host matching: the actual production domain isn't stored anywhere in this repo's env or
 * config (it's a Vercel project setting, not a checked-in value) -- pass --base-url explicitly
 * (or set DEX_APP_BASE_URL) to also verify the destination's host. Without it, this script
 * matches on path+method only and prints a reduced-confidence warning; it still refuses to
 * --apply anything it can't positively identify either way.
 *
 * Usage:
 *   npx tsx scripts/reconcile-qstash-schedule.ts                      # dry-run (default)
 *   npx tsx scripts/reconcile-qstash-schedule.ts --base-url https://dex.example.com
 *   npx tsx scripts/reconcile-qstash-schedule.ts --apply              # NOT run this session --
 *                                                                      # mutating QStash needs
 *                                                                      # the account owner's
 *                                                                      # explicit go-ahead.
 *
 * Requires QSTASH_TOKEN in the environment (already in .env.local per Phase 1B).
 */
import { Client } from '@upstash/qstash';

const DEX_SCHEDULE_LABEL = 'dex-owned';

export interface DexOwnedRoute {
  path: string;
  cronDescription: string;
  expectedMethod: string;
}

// Both real background sweeps this codebase needs, each on the same interval as the existing
// scan sweep (*/3 * * * *, confirmed live in production 2026-09-30) -- matching the established
// cadence rather than inventing a new one; real volume for both is low (per the Phase 1B and
// Phase 1C ADRs), so there's no case for a tighter interval yet.
export const DEX_OWNED_ROUTES: (DexOwnedRoute & { cron: string })[] = [
  { path: '/api/scan/process', cronDescription: 'Phase 1B scan-job sweep', expectedMethod: 'GET', cron: '*/3 * * * *' },
  { path: '/api/generation/process', cronDescription: 'Phase 1C generation-job sweep', expectedMethod: 'GET', cron: '*/3 * * * *' },
];

interface ReconcileReport {
  route: string;
  matches: { scheduleId: string; destination: string; method: string; cron: string; isPaused: boolean; labeled: boolean }[];
  status: 'ok-single-match' | 'no-match' | 'multiple-matches-needs-review';
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<unparseable-url>';
  }
}

export function matchesRoute(destination: string, method: string, route: DexOwnedRoute, expectedBaseUrl: string | null): boolean {
  if (method.toUpperCase() !== route.expectedMethod) return false;
  let pathname: string;
  try {
    pathname = new URL(destination).pathname;
  } catch {
    return false;
  }
  if (pathname !== route.path) return false;
  if (expectedBaseUrl) {
    try {
      return new URL(destination).host === new URL(expectedBaseUrl).host;
    } catch {
      return false;
    }
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const baseUrlArg = args.find((a) => a.startsWith('--base-url='))?.split('=')[1];
  const expectedBaseUrl = baseUrlArg ?? process.env.DEX_APP_BASE_URL ?? null;

  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    console.error('QSTASH_TOKEN is not set -- cannot reach the QStash management API.');
    process.exit(1);
  }

  if (!expectedBaseUrl) {
    console.warn(
      'WARNING: no --base-url / DEX_APP_BASE_URL given -- matching on destination PATH and METHOD only, not host. ' +
        'This is a reduced-confidence identification; pass the real production base URL for a real ownership check.'
    );
  }

  const client = new Client({ token });
  const schedules = await client.schedules.list();

  console.log(`Found ${schedules.length} total schedule(s) in this QStash account.\n`);

  const reports: ReconcileReport[] = [];
  const claimedScheduleIds = new Set<string>();

  for (const route of DEX_OWNED_ROUTES) {
    const matches = schedules
      .filter((s) => matchesRoute(s.destination, s.method, route, expectedBaseUrl))
      .map((s) => {
        claimedScheduleIds.add(s.scheduleId);
        return {
          scheduleId: s.scheduleId,
          destination: redactUrl(s.destination),
          method: s.method,
          cron: s.cron,
          isPaused: s.isPaused,
          labeled: Boolean(s.labels?.includes(DEX_SCHEDULE_LABEL)),
        };
      });

    const status: ReconcileReport['status'] = matches.length === 0 ? 'no-match' : matches.length === 1 ? 'ok-single-match' : 'multiple-matches-needs-review';
    reports.push({ route: route.path, matches, status });
  }

  console.log('=== Reconciliation report ===\n');
  for (const report of reports) {
    console.log(`Route: ${report.route}`);
    console.log(`Status: ${report.status}`);
    for (const m of report.matches) {
      console.log(`  - schedule ${m.scheduleId} | ${m.method} ${m.destination} | cron="${m.cron}" | paused=${m.isPaused} | labeled=${m.labeled}`);
    }
    if (report.matches.length === 0) console.log('  (none found)');
    console.log('');
  }

  const unclaimed = schedules.filter((s) => !claimedScheduleIds.has(s.scheduleId));
  if (unclaimed.length > 0) {
    console.log(`${unclaimed.length} schedule(s) in this account did not match any known Dex route -- left untouched, never assumed unowned-but-safe-to-delete:`);
    for (const s of unclaimed) {
      console.log(`  - schedule ${s.scheduleId} | ${s.method} ${redactUrl(s.destination)} | cron="${s.cron}"`);
    }
    console.log('');
  }

  const needsAction = reports.filter((r) => r.status !== 'ok-single-match');
  if (needsAction.length === 0) {
    console.log('Every expected Dex route has exactly one matching schedule. Nothing to reconcile.');
    return;
  }

  console.log(`${needsAction.length} route(s) need attention: ${needsAction.map((r) => r.route).join(', ')}`);

  if (!apply) {
    console.log('\nDry-run only (default) -- no schedules were created, paused, or deleted. Re-run with --apply to make changes (requires the account owner\'s explicit go-ahead; this script never runs --apply on its own).');
    return;
  }

  // Only a clean 'no-match' is auto-resolved (there is exactly one correct action: create the
  // missing schedule). 'multiple-matches-needs-review' is never auto-resolved -- picking which
  // of several candidate schedules to pause/delete is exactly the ambiguous judgment call this
  // script refuses to guess at; it stays reported, not acted on, every run until a human
  // resolves it by hand in the Upstash console.
  const creatable = needsAction.filter((r) => r.status === 'no-match');
  const needsReview = needsAction.filter((r) => r.status === 'multiple-matches-needs-review');
  if (needsReview.length > 0) {
    console.log(`\n${needsReview.length} route(s) have multiple matching schedules and need manual review (not auto-resolved): ${needsReview.map((r) => r.route).join(', ')}`);
  }
  if (creatable.length === 0) {
    console.log('\nNo route is cleanly creatable (no-match) -- nothing left for --apply to do.');
    return;
  }
  if (!expectedBaseUrl) {
    console.error(
      '\n--apply with a missing schedule requires --base-url (or DEX_APP_BASE_URL) to know the real destination host -- refusing to guess a production URL.'
    );
    process.exit(1);
  }

  for (const report of creatable) {
    const route = DEX_OWNED_ROUTES.find((r) => r.path === report.route)!;
    const destination = new URL(route.path, expectedBaseUrl).toString();
    console.log(`\nCreating schedule for ${route.path} -> ${redactUrl(destination)} (cron="${route.cron}")...`);
    const created = await client.schedules.create({
      destination,
      cron: route.cron,
      method: route.expectedMethod as 'GET',
      label: DEX_SCHEDULE_LABEL,
    });
    console.log(`Created schedule ${created.scheduleId} for ${route.path}.`);
  }
}

// Only run when invoked directly (`npx tsx scripts/reconcile-qstash-schedule.ts`) -- importing
// this module for its pure functions (matchesRoute/redactUrl, exercised by
// reconcile-qstash-schedule.test.ts) must never trigger a real network call.
if (process.argv[1]?.endsWith('reconcile-qstash-schedule.ts')) {
  main().catch((err) => {
    console.error('Reconciliation failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
