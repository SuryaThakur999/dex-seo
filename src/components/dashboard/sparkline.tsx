'use client';

import { Area, AreaChart } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

export function Sparkline({
  data,
  dataKey = 'scans',
  color = 'var(--dex-accent, #ff4d2e)',
}: {
  data: object[];
  dataKey?: string;
  color?: string;
}) {
  const chartConfig: ChartConfig = { [dataKey]: { label: dataKey, color } };

  return (
    <ChartContainer config={chartConfig} className="h-16 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <Area dataKey={dataKey} type="monotone" fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}
