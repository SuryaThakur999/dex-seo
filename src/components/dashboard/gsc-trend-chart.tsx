'use client';

import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DailyPerformance } from '@/lib/gsc-client';

const METRICS = [
  { value: 'clicks', label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'ctr', label: 'CTR' },
] as const;
type MetricValue = (typeof METRICS)[number]['value'];

function formatDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Real day-by-day Google Search Console performance -- directive requirement: "Only display
 * GSC traffic, click and impression trends when real connected data exists." The caller (the
 * dashboard page) only renders this component at all when a resolved GSC connection exists;
 * this component itself only handles "not enough rows yet" for a connection that's real but
 * too new to have history -- never a fabricated trend line.
 */
export function GscTrendChart({ data }: { data: DailyPerformance[] }) {
  const [metric, setMetric] = useState<MetricValue>('clicks');
  const activeMetric = METRICS.find((m) => m.value === metric)!;
  const chartData = data.map((d) => ({ ...d, label: formatDay(d.date) }));
  const hasEnoughHistory = data.length >= 2;

  if (!hasEnoughHistory) {
    return (
      <p className="text-xs text-muted-foreground">
        Not enough Search Console history yet for a trend — check back after a few more days of data.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={metric} onValueChange={(v) => setMetric(v as MetricValue)}>
        <TabsList>
          {METRICS.map((m) => (
            <TabsTrigger key={m.value} value={m.value}>
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="h-[180px] w-full" role="img" aria-label={`${activeMetric.label} per day from Google Search Console`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="gsc-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              width={36}
              allowDecimals={metric === 'ctr'}
              tickFormatter={(v: number) => (metric === 'ctr' ? `${(v * 100).toFixed(0)}%` : String(v))}
            />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--foreground)' }}
              formatter={(value) => [metric === 'ctr' ? `${(Number(value) * 100).toFixed(1)}%` : value, activeMetric.label]}
            />
            <Area
              type="monotone"
              dataKey={metric}
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#gsc-trend-fill)"
              dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
