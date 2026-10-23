import React from 'react';
import type { PendingMeasurement } from '@/lib/dashboard-stats';

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}

/** Real baseline-captured, not-yet-measured actions — an expected date, never a guess. */
export function PendingMeasurementsList({ items, now = new Date() }: { items: PendingMeasurement[]; now?: Date }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing awaiting measurement right now.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.slice(0, 6).map((item) => {
        const days = daysUntil(item.expectedAt, now);
        return (
          <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-mono text-xs text-foreground">{item.pageUrl}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {days > 0 ? `${days} day${days === 1 ? '' : 's'} left` : 'Expected any day'}
            </span>
          </li>
        );
      })}
      {items.length > 6 && <li className="text-xs text-muted-foreground">+{items.length - 6} more</li>}
    </ul>
  );
}
