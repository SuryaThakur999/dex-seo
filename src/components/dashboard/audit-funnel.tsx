import React from 'react';
import type { FunnelStage } from '@/lib/dashboard-stats';

// Fixed order, one hue per stage — status-adjacent but not the categorical chart palette
// (a funnel is a single sequence, not several comparable series), stepping from the app's
// own accent orange (earliest/broadest stage) toward success mint (latest/narrowest).
const STAGE_COLOR = ['var(--dex-app-amber)', 'var(--accent)', 'var(--dex-app-warning)', 'var(--dex-app-success)'];

// Bar width for one stage, clamped to the container's own 100% -- exported so the clamping
// rule is independently testable without rendering. pctOfPrevious has no cross-stage ceiling
// (Findings and Draft-ready can each exceed the stage before them, since a single page can
// carry more than one finding or draft), so the text label is left uncapped on purpose while
// the bar itself never draws past its box. A null pctOfPrevious (the first stage, or a zero
// preceding count) has nothing to measure against, so it renders as the funnel's own full-width
// baseline rather than guessing a fraction. The 4% floor keeps a real nonzero stage visible
// instead of collapsing to a sliver.
export function stageBarWidthPct(pctOfPrevious: number | null): number {
  if (pctOfPrevious === null) return 100;
  return Math.min(100, Math.max(4, pctOfPrevious));
}

/**
 * From the most recent scan only (see computeAuditFunnel's own comment) — deliberately has
 * no "Discovered" stage, since no real discoverable-page denominator exists in this codebase.
 */
export function AuditFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="flex flex-col gap-3">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-foreground">{stage.label}</span>
            <span className="text-muted-foreground">
              {stage.count.toLocaleString()}
              {stage.pctOfPrevious !== null && <span className="ml-1.5">({stage.pctOfPrevious}%)</span>}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${stageBarWidthPct(stage.pctOfPrevious)}%`, backgroundColor: STAGE_COLOR[i % STAGE_COLOR.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
