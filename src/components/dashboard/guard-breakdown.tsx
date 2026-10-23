'use client';

import Link from 'next/link';
import { Pie, PieChart, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { GuardCounts } from '@/lib/dashboard-stats';
import { OUTCOME_LABEL } from '@/lib/guard-outcome-ui';

const COLORS: Record<keyof GuardCounts, string> = {
  pass: 'var(--dex-app-success, #10b981)',
  flag: 'var(--dex-app-warning, #ffb020)',
  block: 'var(--dex-app-danger, #f87171)',
};

const chartConfig: ChartConfig = {
  pass: { label: OUTCOME_LABEL.pass, color: COLORS.pass },
  flag: { label: OUTCOME_LABEL.flag, color: COLORS.flag },
  block: { label: OUTCOME_LABEL.block, color: COLORS.block },
};

export function GuardBreakdown({ counts }: { counts: GuardCounts }) {
  const total = counts.pass + counts.flag + counts.block;
  const data = (Object.keys(counts) as (keyof GuardCounts)[]).map((key) => ({
    key,
    label: OUTCOME_LABEL[key],
    value: counts[key],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">ProofLayer breakdown</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {total === 0 && (
          <p className="text-sm text-muted-foreground">No drafts checked yet. Run a scan to see ProofLayer in action.</p>
        )}
        {total > 0 && (
          <div className="flex items-center gap-4">
            <ChartContainer
              config={chartConfig}
              className="h-[140px] w-[140px] shrink-0"
              role="img"
              aria-label={`ProofLayer breakdown: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}
            >
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie data={data} dataKey="value" nameKey="label" innerRadius={40} outerRadius={64} strokeWidth={2}>
                  {data.map((entry) => (
                    <Cell key={entry.key} fill={COLORS[entry.key]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="flex flex-1 flex-col gap-2">
              {data.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[entry.key] }} />
                    {entry.label}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {entry.value} &middot; {total > 0 ? Math.round((entry.value / total) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <Link href="/review" className="mt-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
          View review queue &rarr;
        </Link>
      </CardContent>
    </Card>
  );
}
