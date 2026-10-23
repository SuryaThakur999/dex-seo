'use client';

import { Bar, BarChart } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

export function MiniBarChart({
  data,
  dataKey = 'value',
  color = 'var(--accent)',
  label,
}: {
  data: object[];
  dataKey?: string;
  color?: string;
  label?: string;
}) {
  const chartConfig: ChartConfig = { [dataKey]: { label: dataKey, color } };

  return (
    <ChartContainer
      config={chartConfig}
      className="h-16 w-full"
      role="img"
      aria-label={label ?? `${dataKey} chart`}
    >
      <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
