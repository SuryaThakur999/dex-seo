'use client';

import { Bar, BarChart, ReferenceLine, XAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { PassRateTarget } from '@/lib/dashboard-stats';

const chartConfig: ChartConfig = { passRate: { label: 'Pass rate', color: 'var(--dex-app-success, #10b981)' } };

export function PassRateBullet({ data }: { data: PassRateTarget }) {
  const chartData = [{ name: 'ProofLayer pass rate', passRate: data.passRate }];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">ProofLayer pass rate</span>
        <span className="text-sm font-semibold text-foreground">
          {data.passRate}% <span className="font-normal text-muted-foreground">/ {data.target}% target</span>
        </span>
      </div>
      <ChartContainer
        config={chartConfig}
        className="h-10 w-full"
        role="img"
        aria-label={`ProofLayer pass rate ${data.passRate}% against a ${data.target}% target`}
      >
        <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <Bar dataKey="passRate" fill="var(--color-passRate)" radius={[4, 4, 4, 4]} barSize={16} />
          <ReferenceLine x={data.target} stroke="var(--dex-app-warning, #ffb020)" strokeWidth={2} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
