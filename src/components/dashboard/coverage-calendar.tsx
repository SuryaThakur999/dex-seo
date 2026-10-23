import React from 'react';
import type { CoverageDay } from '@/lib/dashboard-stats';

const STATUS_STYLE: Record<CoverageDay['status'], string> = {
  completed: 'bg-[var(--dex-app-success)]',
  running: 'border-2 border-[var(--accent)] bg-transparent',
  failed: 'bg-[var(--dex-app-danger)]',
  none: 'bg-muted',
};

const STATUS_LABEL: Record<CoverageDay['status'], string> = {
  completed: 'Scan completed',
  running: 'Running',
  failed: 'Scan failed',
  none: 'No scan',
};

/** One real ScanJob-derived square per day — 'none' is an honest gap, never a fabricated zero. */
export function CoverageCalendar({ days }: { days: CoverageDay[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="img" aria-label="Scan coverage by day">
        {days.map((day) => (
          <div
            key={day.date}
            title={`${day.date} — ${STATUS_LABEL[day.status]}`}
            className={`h-5 w-5 rounded-sm ${STATUS_STYLE[day.status]}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {(Object.keys(STATUS_LABEL) as CoverageDay['status'][]).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_STYLE[status]}`} aria-hidden />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>
    </div>
  );
}
