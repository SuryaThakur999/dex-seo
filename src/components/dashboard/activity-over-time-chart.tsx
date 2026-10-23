'use client';

import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DailyCount } from '@/lib/dashboard-stats';

const SERIES = [
  { value: 'crawl', label: 'Crawl activity', unit: 'pages' },
  { value: 'findings', label: 'Findings', unit: 'findings' },
  { value: 'drafts', label: 'Draft success', unit: 'drafts' },
  { value: 'review', label: 'Review time', unit: 'minutes' },
] as const;
type SeriesValue = (typeof SERIES)[number]['value'];

function formatDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * One real per-day series per tab — a day with `value: null` (no scan ran, or no reviews
 * happened) renders as a genuine gap in the line, never a false zero.
 */
export function ActivityOverTimeChart({
  crawl,
  findings,
  drafts,
  review,
}: {
  crawl: DailyCount[];
  findings: DailyCount[];
  drafts: DailyCount[];
  review: DailyCount[];
}) {
  const [active, setActive] = useState<SeriesValue>('crawl');
  const dataBySeries: Record<SeriesValue, DailyCount[]> = { crawl, findings, drafts, review };
  const activeSeries = SERIES.find((s) => s.value === active)!;
  const data = dataBySeries[active].map((d) => ({ ...d, label: formatDay(d.date) }));
  const hasAnyData = data.some((d) => d.value !== null && d.value > 0);

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={active} onValueChange={(v) => setActive(v as SeriesValue)}>
        <TabsList className="w-full justify-start overflow-x-auto">
          {SERIES.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!hasAnyData && (
        <p className="text-xs text-muted-foreground">Not enough history yet for {activeSeries.label.toLowerCase()}.</p>
      )}
      <div className="h-[220px] w-full" role="img" aria-label={`${activeSeries.label} per day`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--foreground)' }}
              formatter={(value) => [
                value === null || value === undefined ? 'No data' : `${value} ${activeSeries.unit}`,
                activeSeries.label,
              ]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#activity-fill)"
              connectNulls={false}
              dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
