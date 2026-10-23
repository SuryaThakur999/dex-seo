'use client';

import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { ActivityDay } from '@/lib/dashboard-stats';

const chartConfig: ChartConfig = {
  scans: { label: 'Scans', color: 'var(--dex-accent, #ff4d2e)' },
  drafts: { label: 'Drafts', color: 'var(--dex-app-amber, #ffb020)' },
};

export function ActivityChart({ data }: { data: ActivityDay[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Activity, last 14 days</CardTitle>
      </CardHeader>
      <CardContent className="pl-0">
        <ChartContainer config={chartConfig} className="h-[220px] w-full">
          <AreaChart data={data} margin={{ left: 12, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
            <Area
              dataKey="scans"
              type="monotone"
              fill="var(--dex-accent, #ff4d2e)"
              fillOpacity={0.15}
              stroke="var(--dex-accent, #ff4d2e)"
              strokeWidth={2}
              stackId="a"
            />
            <Area
              dataKey="drafts"
              type="monotone"
              fill="var(--dex-app-amber, #ffb020)"
              fillOpacity={0.15}
              stroke="var(--dex-app-amber, #ffb020)"
              strokeWidth={2}
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
