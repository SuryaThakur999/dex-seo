import React from 'react';
import type { MeasurementJourney as MeasurementJourneyData } from '@/lib/dashboard-stats';

const STAGES = [
  { key: 'approved', label: 'Approved' },
  { key: 'baselineCaptured', label: 'Baseline captured' },
  { key: 'observing', label: '28-day observation' },
  { key: 'measured', label: 'Outcome measured' },
] as const;

/**
 * Directive: "Replace duplicated empty cards with one measurement timeline." Real per-action
 * stage counts (computeMeasurementJourney) — "Evidence ready" is not a distinct count, since
 * the evidence PDF works off any already-measured action; shown as identical to Measured.
 */
export function MeasurementJourney({ data }: { data: MeasurementJourneyData }) {
  const counts = [...STAGES.map((s) => data[s.key]), data.measured];
  const labels = [...STAGES.map((s) => s.label), 'Evidence ready'];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-1">
        {counts.map((count, i) => (
          <div key={labels[i]} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                count > 0 ? 'border-[var(--dex-app-success)] text-[var(--dex-app-success)]' : 'border-border text-muted-foreground'
              }`}
            >
              {count}
            </div>
            {i < counts.length - 1 && <div className="hidden h-0.5 w-full bg-border sm:block" />}
          </div>
        ))}
      </div>
      <div className="flex gap-1 text-center text-[11px] text-muted-foreground">
        {labels.map((label) => (
          <span key={label} className="flex-1">
            {label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Each approved change follows the same path: approve in Dex, capture a baseline, wait 28 days, measure the
        outcome, then evidence becomes available. This confirms the change moved through Dex — it does not by
        itself prove search traffic changed.
      </p>
    </div>
  );
}
