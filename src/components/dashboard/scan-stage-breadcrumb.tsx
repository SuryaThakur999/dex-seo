import React from 'react';
import { STAGE_LABELS, STAGE_ORDER, furthestStageReached, type ScanStage } from '@/lib/scan-stages';

// Directive-required stage vocabulary (Discover → Crawl → Analyze → Verify → Save) derived
// entirely from messages the job actually logged — see scan-stages.ts. Renders nothing when
// there's no log history yet, matching ScanTerminal's own idle-hide behavior; a queued job with
// no lines shows no stages "reached" rather than implying crawling already started.
//
// Deliberately honest about what this number means: it is the furthest stage the log has
// CONFIRMED, not "the stage currently executing" (a running job could be mid-way through the
// next stage already, with its first message not yet written) and not "the exact point of
// failure" (a failed job's true failure could sit anywhere after the last confirmed stage, not
// necessarily inside it). The job's own Running/Completed/Failed status is shown elsewhere
// (the Badge in live-scan-panel's header) — this component never re-derives or restates that.
export function ScanStageBreadcrumb({ lines, status }: { lines: { message: string }[]; status: string }) {
  if (lines.length === 0) return null;

  const furthest = furthestStageReached(lines.map((l) => l.message));
  const furthestIndex = furthest ? STAGE_ORDER.indexOf(furthest) : -1;
  const failed = status === 'failed';

  return (
    <div className="flex flex-col gap-0.5">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11px]" aria-label="Scan stage progress">
        {STAGE_ORDER.map((stage: ScanStage, i) => {
          const reached = i <= furthestIndex;
          const isFurthest = i === furthestIndex;
          return (
            <li key={stage} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-muted-foreground" aria-hidden="true">
                  →
                </span>
              )}
              <span
                aria-current={isFurthest ? 'step' : undefined}
                className={
                  isFurthest && failed
                    ? 'text-destructive font-medium'
                    : reached
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                }
              >
                {STAGE_LABELS[stage]}
                <span className="sr-only">
                  {reached ? (isFurthest ? ' — last stage confirmed by the log' : ' — confirmed') : ' — not yet confirmed'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {failed && furthestIndex >= 0 && (
        <p className="text-[10px] text-muted-foreground">
          Job failed — {STAGE_LABELS[STAGE_ORDER[furthestIndex]]} is the last stage the log confirms; the exact failure point isn&apos;t established.
        </p>
      )}
    </div>
  );
}
