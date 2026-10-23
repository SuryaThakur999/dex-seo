import { notFound } from 'next/navigation';
import { FileMagnifyingGlass, ShieldCheck, Coins } from '@phosphor-icons/react/dist/ssr';
import { StatCard } from '@/components/dashboard/stat-card';
import { LiveScanPanel } from '@/components/dashboard/live-scan-panel';
import { GuardBreakdown } from '@/components/dashboard/guard-breakdown';
import { ScanHealthCard } from '@/components/dashboard/scan-health-card';
import { MiniBarChart } from '@/components/dashboard/mini-bar-chart';
import { ComparisonBar } from '@/components/dashboard/comparison-bar';
import {
  computeActivitySeries,
  computeGuardCatchSeries,
  computeTokenSeries,
  computeJobDelta,
  computeDelta,
} from '@/lib/dashboard-stats';

export default function DashboardPreview() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  const jobs = [
    // Safe deterministic fixture for Crawl Runner browser verification (previewMode below
    // disables real polling/POST, so this never touches a real scan): a static in-flight job
    // that never resolves, giving unlimited time to test keyboard/touch/pause/exit/hidden-tab
    // behavior without racing a real scan's 5-10s completion window.
    { id: 'preview-running', status: 'running', createdAt: new Date(), completedAt: null, error: null, resultSummary: null },
    {
      id: '1',
      status: 'completed',
      createdAt: new Date(Date.now() - 3 * 3600000),
      completedAt: new Date(Date.now() - 3 * 3600000),
      error: null,
      resultSummary: { pagesScanned: 41, pagesFlagged: 5, draftsCreated: 3, errors: [] },
    },
    { id: '2', status: 'failed', createdAt: new Date(Date.now() - 26 * 3600000), completedAt: new Date(Date.now() - 26 * 3600000), error: 'Scan timed out', resultSummary: null },
    {
      id: '3',
      status: 'completed',
      createdAt: new Date(Date.now() - 9 * 24 * 3600000),
      completedAt: new Date(Date.now() - 9 * 24 * 3600000),
      error: null,
      resultSummary: { pagesScanned: 37, pagesFlagged: 4, draftsCreated: 2, errors: [] },
    },
  ];

  const scans = Array.from({ length: 10 }, (_, i) => ({ createdAt: new Date(Date.now() - i * 26 * 3600000) }));
  const actions = Array.from({ length: 22 }, (_, i) => ({
    createdAt: new Date(Date.now() - i * 11 * 3600000),
    tokenCost: 40 + (i % 5) * 15,
    guardResult: { outcome: i % 6 === 0 ? 'block' : i % 3 === 0 ? 'flag' : 'pass' },
  }));

  const activitySeries = computeActivitySeries(scans, actions, 14);
  const guardCatchSeries = computeGuardCatchSeries(actions, 14);
  const tokenSeries = computeTokenSeries(actions, 14);
  const pagesScannedDelta = computeJobDelta(jobs);
  const currentWeekCatches = 3;
  const previousWeekCatches = 5;
  const guardCatchesDelta = computeDelta(currentWeekCatches, previousWeekCatches);
  const tokensSpentDelta = computeDelta(720, 640);

  return (
    <div className="dex-app dark min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">Dashboard</h1>
          </div>
        </header>

        <div className="mt-8">
          <ScanHealthCard
            websiteUrl="getbetter.io"
            pagesScanned={41}
            pendingCount={6}
            activity={activitySeries}
            gscConnected={true}
            delta={pagesScannedDelta}
            updatedAt={jobs[0].completedAt}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label="Pages scanned"
            value="41"
            hint="Last scan"
            icon={<FileMagnifyingGlass size={16} weight="regular" />}
            tone="accent"
            delta={pagesScannedDelta}
            chart={<MiniBarChart data={activitySeries} dataKey="scans" />}
          />
          <StatCard
            label="ProofLayer catches"
            value="3"
            hint="Flagged or blocked before reaching you · vs last week"
            icon={<ShieldCheck size={16} weight="regular" />}
            delta={guardCatchesDelta}
            chart={<MiniBarChart data={guardCatchSeries} dataKey="value" />}
          />
          <StatCard
            label="Tokens spent"
            value="12,480"
            hint="All-time · vs last week"
            icon={<Coins size={16} weight="regular" />}
            delta={tokensSpentDelta}
            chart={<MiniBarChart data={tokenSeries} dataKey="value" color="var(--dex-app-amber, #ffb020)" />}
          />
          <ComparisonBar label="ProofLayer catches, week over week" current={currentWeekCatches} previous={previousWeekCatches} />
        </div>

        <div className="mt-6">
          <GuardBreakdown counts={{ pass: 28, flag: 5, block: 2 }} />
        </div>

        <div className="mt-6">
          <LiveScanPanel websiteId="preview" initialJobs={jobs} opportunitiesFoundCount={7} draftsReadyCount={3} previewMode />
        </div>
      </main>
    </div>
  );
}
