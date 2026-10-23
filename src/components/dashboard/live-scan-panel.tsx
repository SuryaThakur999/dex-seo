'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useReducedMotion } from 'motion/react';
import { GameController } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BorderBeam } from '@/components/magicui/border-beam';
import type { ScanActivityJob } from '@/components/dashboard/scan-activity';
import { ScanTerminal } from '@/components/dashboard/scan-terminal';
import { ScanStageBreadcrumb } from '@/components/dashboard/scan-stage-breadcrumb';
import { DexSignalMark } from '@/components/app-shell/dex-signal-mark';
import { parseScanResultSummary, formatRelativeTime } from '@/lib/dashboard-stats';

// Lazy-loaded client-side only — DEX CONTINUATION MASTER DIRECTIVE Phase 4: the game must
// never be part of the initial page bundle for customers who never open it.
const CrawlRunner = dynamic(() => import('@/components/dashboard/crawl-runner').then((m) => m.CrawlRunner), {
  ssr: false,
});

const POLL_INTERVAL_MS = 3000;
const IN_FLIGHT_STATUSES = new Set(['queued', 'running']);
// Product fix: YOKI's real scans finish in 5-10s, faster than a customer can meaningfully
// react to a game invite. Delay the invite by this long — if the scan is still running once
// it fires, there's real time left to play; if the scan already finished, the invite never
// appears and the real completion receipt shows immediately instead.
const GAME_INVITE_DELAY_MS = 4000;

type GamePreference = 'ask' | 'always_game' | 'always_watch' | 'disabled';

// Matches STALE_RUNNING_MINUTES in src/app/api/scan/process/route.ts, which reaps a stuck
// 'running' job at the same threshold — no point polling past the point the job is considered dead.
const MAX_POLL_MINUTES = 10;
const MAX_POLL_TICKS = Math.floor((MAX_POLL_MINUTES * 60 * 1000) / POLL_INTERVAL_MS);

const POLL_ERROR_MESSAGE = "Couldn't check scan status. Refresh to see the latest.";
const POLL_TIMEOUT_MESSAGE = 'Still checking — refresh in a few minutes to see the latest.';

// Phase 1E, Part G: /api/scan already runs a newly-enqueued job inline in the same request
// (see enqueueScanIfNeeded + claimAndRunScanJob in that route) -- QStash's sweep in
// /api/scan/process is only the crash-safety-net for when that inline call itself dies before
// it can claim the job. A job still sitting 'queued' this long means the inline trigger failed
// and only the sweep is left to pick it up -- real, honest signal to show, not a fabricated
// progress estimate. 2 minutes is well past every real scan's normal 5-10s start latency.
const QUEUED_DELAY_THRESHOLD_MS = 2 * 60 * 1000;
const QUEUE_DELAY_MESSAGE = "Delayed — your audit is safely queued. You don't need to start it again.";

interface RawJob {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  resultSummary: unknown;
}

function parseJobs(raw: RawJob[]): ScanActivityJob[] {
  return raw.map((job) => ({
    ...job,
    createdAt: new Date(job.createdAt),
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
  }));
}

export function LiveScanPanel({
  websiteId,
  initialJobs,
  opportunitiesFoundCount,
  draftsReadyCount,
  initialGamePreference = 'ask',
  previewMode = false,
  autoStartFirstScan = false,
}: {
  websiteId: string;
  initialJobs: ScanActivityJob[];
  /** Real Finding count from the latest completed scan — used only in the completion receipt. */
  opportunitiesFoundCount: number;
  /** Real count of pending Actions with a succeeded draft — used only in the completion receipt. */
  draftsReadyCount: number;
  /** Real Customer.gamePreference, set in Settings — the workspace-wide source of truth. */
  initialGamePreference?: GamePreference;
  /**
   * Safe deterministic development fixture only (dashboard-preview route) — disables real
   * status polling and the real /api/scan POST so Crawl Runner's movement/pause/exit/hidden-
   * tab behavior can be browser-verified without starting, manipulating, or depending on a
   * real production scan.
   */
  previewMode?: boolean;
  /** Starts the site's first scan on mount. A new customer arrives from "Start my audit" with
   *  no scan yet, and before this there was no button to press in that state. */
  autoStartFirstScan?: boolean;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  // Deliberately not resynced with `initialJobs` after `router.refresh()`: once polling starts,
  // `jobs` is the source of truth and a resync could stomp a newer polled state with a stale prop.
  const [jobs, setJobs] = useState(initialJobs);
  const [logLines, setLogLines] = useState<{ id: string; message: string; createdAt: string }[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const gamePreference = initialGamePreference;
  const [gameInviteDismissed, setGameInviteDismissed] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [inviteEligible, setInviteEligible] = useState(false);
  // Agent B finding: exiting the game left keyboard/AT focus dropped on <body>. Returns it
  // to a stable, focusable anchor in this same panel instead.
  const liveActivityHeadingRef = useRef<HTMLDivElement>(null);

  // DEX CONTINUATION MASTER DIRECTIVE Phase 3: "After completion, collapse the terminal into
  // a compact result receipt... secondary action: Expand scan report." Defaults closed on
  // every fresh completed/failed job; a rerun resets it via the inFlight branch below.
  const [showFullReport, setShowFullReport] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCountRef = useRef(0);

  const inFlight = !pollError && jobs.length > 0 && IN_FLIGHT_STATUSES.has(jobs[0].status);

  // The game never outlives the real scan it was offered alongside — once the audit finishes
  // (or fails), close it so the customer lands back on real results, not a lingering game.
  useEffect(() => {
    if (!inFlight) setGameOpen(false);
  }, [inFlight]);

  // Delay the invite so a fast scan (YOKI: 5-10s) never flashes it — see GAME_INVITE_DELAY_MS.
  useEffect(() => {
    if (!inFlight) {
      setInviteEligible(false);
      return;
    }
    const timer = setTimeout(() => {
      setInviteEligible(true);
      if (gamePreference === 'always_game') setGameOpen(true);
    }, GAME_INVITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [inFlight, gamePreference]);
  const latestJob = jobs[0];
  const latestCompletedSummary =
    latestJob?.status === 'completed' ? parseScanResultSummary(latestJob.resultSummary) : null;
  const latestFailed = latestJob?.status === 'failed' ? latestJob : null;
  const queuedTooLong =
    latestJob?.status === 'queued' && Date.now() - latestJob.createdAt.getTime() > QUEUED_DELAY_THRESHOLD_MS;
  const latestCancelled = latestJob?.status === 'cancelled' ? latestJob : null;

  // /api/scan currently runs the whole scan inline before responding (no async worker sweep
  // exists yet), so a plain <form> POST navigates the browser away for that entire window and
  // no client component — including this one — stays mounted to show anything. Firing it as a
  // fetch instead, with an optimistic "queued" entry the instant the button is pressed, is what
  // actually gives the border/terminal a real window to render: the poll loop below then picks
  // up the true job state (still real, not simulated) as soon as it exists.
  function handleScanNow() {
    if (inFlight) return;
    setShowFullReport(false);
    setGameInviteDismissed(false);
    // Auto-open for 'always_game' waits for inviteEligible too (see that effect) — a fast
    // scan should never flash the game open only to slam it shut a second later.
    setGameOpen(false);
    setJobs((prev) => [
      {
        id: `optimistic-${Date.now()}`,
        status: 'queued',
        createdAt: new Date(),
        completedAt: null,
        error: null,
        resultSummary: null,
      },
      ...prev,
    ]);
    if (previewMode) return; // fixture only — never a real scan, never a real POST
    const form = new FormData();
    form.set('websiteId', websiteId);
    fetch('/api/scan', { method: 'POST', body: form }).catch(() => setPollError(POLL_ERROR_MESSAGE));
  }

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartFirstScan || autoStartedRef.current || initialJobs.length > 0) return;
    autoStartedRef.current = true;
    handleScanNow();
    // Runs once on mount only; handleScanNow reads current state through its own closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The optimistic entry from handleScanNow above has no real id yet (the POST above hasn't
  // resolved to a created job), so a cancel attempt against it would just 404 — only a job id
  // that came back from a real poll of /api/scan/status can be cancelled.
  const canCancel = inFlight && !previewMode && jobs[0] && !jobs[0].id.startsWith('optimistic-');

  function handleCancel() {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    fetch(`/api/scan/${jobs[0].id}/cancel`, { method: 'POST' })
      .catch(() => setPollError(POLL_ERROR_MESSAGE))
      .finally(() => setCancelling(false));
  }

  useEffect(() => {
    if (!inFlight || previewMode) return; // fixture keeps a static in-flight state, no real polling

    tickCountRef.current = 0;

    const poll = async () => {
      if (document.visibilityState === 'hidden') return;

      tickCountRef.current += 1;
      if (tickCountRef.current > MAX_POLL_TICKS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setPollError(POLL_TIMEOUT_MESSAGE);
        return;
      }

      try {
        const res = await fetch(`/api/scan/status?websiteId=${websiteId}`, { cache: 'no-store' });
        if (!res.ok) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setPollError(POLL_ERROR_MESSAGE);
          return;
        }
        const data: { jobs: RawJob[]; logLines: { id: string; message: string; createdAt: string }[] } = await res.json();
        const nextJobs = parseJobs(data.jobs);
        setJobs(nextJobs);
        setLogLines(data.logLines);

        const stillInFlight = nextJobs.length > 0 && IN_FLIGHT_STATUSES.has(nextJobs[0].status);
        if (!stillInFlight) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          router.refresh();
        }
      } catch {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setPollError(POLL_ERROR_MESSAGE);
      }
    };

    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [inFlight, router, websiteId]);

  // Live, expanded terminal while a job runs, or when the reader explicitly asks to see it
  // again after completion. Otherwise a completed/failed job with real log history collapses
  // into the compact receipt below — Phase 3: "collapse the terminal into a compact result
  // receipt" rather than leaving the full log open forever.
  const canExpandReport = !inFlight && !showFullReport && logLines.length > 0;
  const showReceipt = canExpandReport && Boolean(latestCompletedSummary);
  const latestCancelledSummary = latestCancelled ? parseScanResultSummary(latestCancelled.resultSummary) : null;
  const lastCheckedLabel = latestJob
    ? `Last checked ${formatRelativeTime(latestJob.completedAt ?? latestJob.createdAt)}`
    : 'No scans yet';

  return (
    <div id="scan-control" className="scroll-mt-6">
      {!inFlight && !showFullReport ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{lastCheckedLabel}</span>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={handleScanNow} className="font-medium text-accent underline-offset-4 hover:underline">
            Check again
          </button>
          {pollError && <span className="text-destructive">{pollError}</span>}
          {queuedTooLong && <span>{QUEUE_DELAY_MESSAGE}</span>}
          {latestFailed && (
            <span className="text-destructive">
              Last scan failed{latestFailed.error ? `: ${latestFailed.error}` : ''}.
              {canExpandReport && (
                <>
                  {' '}
                  <button type="button" onClick={() => setShowFullReport(true)} className="font-medium underline-offset-4 hover:underline">
                    Expand scan report
                  </button>
                </>
              )}
            </span>
          )}
          {latestCancelled && (
            <span>
              Scan cancelled{latestCancelledSummary ? ` — ${latestCancelledSummary.pagesScanned} pages checked before stopping.` : '.'}
              {canExpandReport && (
                <>
                  {' '}
                  <button type="button" onClick={() => setShowFullReport(true)} className="font-medium underline-offset-4 hover:underline">
                    Expand scan report
                  </button>
                </>
              )}
            </span>
          )}
          {showReceipt && latestCompletedSummary && (
            <>
              <a href="#findings" className="font-medium text-accent underline-offset-4 hover:underline">View opportunities</a>
              <button type="button" onClick={() => setShowFullReport(true)} className="font-medium underline-offset-4 hover:underline">Expand scan report</button>
            </>
          )}
        </div>
      ) : (
        <Card className="dex-app-terminal relative overflow-hidden">
          {inFlight && !reduce && <BorderBeam colorFrom="var(--accent)" colorTo="var(--dex-app-warning, #ffb020)" />}
          {inFlight && reduce && (
            <div className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-accent" aria-hidden="true" />
          )}
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle ref={liveActivityHeadingRef} tabIndex={-1} className="text-base font-medium focus:outline-none">
              Live activity
            </CardTitle>
            {inFlight && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{jobs[0]?.status === 'queued' ? 'Queued' : 'Running'}</Badge>
                {canCancel && (
                  <Button type="button" variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? 'Cancelling…' : 'Cancel scan'}
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            <ScanStageBreadcrumb lines={logLines} status={latestJob?.status ?? 'queued'} />
            <ScanTerminal lines={logLines} running={inFlight} />
            {!inFlight && logLines.length > 0 && (
              <button type="button" onClick={() => setShowFullReport(false)} className="self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Collapse
              </button>
            )}
            {inFlight && gameOpen && (
              <CrawlRunner onExit={() => { setGameOpen(false); liveActivityHeadingRef.current?.focus(); }} />
            )}
            {inFlight && inviteEligible && !gameOpen && !gameInviteDismissed && gamePreference === 'ask' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <GameController size={16} weight="regular" aria-hidden="true" />
                    Want to play while I work?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Explore the web with a mini crawler, collect signals and uncover hidden paths.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="accent" size="sm" onClick={() => setGameOpen(true)}>
                    Launch Crawl Runner
                  </Button>
                  <button
                    type="button"
                    onClick={() => setGameInviteDismissed(true)}
                    className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Watch scan
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
