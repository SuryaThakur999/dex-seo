'use client';

import { Line, LineChart, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { ComparisonBar } from '@/components/dashboard/comparison-bar';
import type { OutcomeEvidenceRow } from '@/lib/dashboard-stats';

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const trendChartConfig: ChartConfig = { clicksDelta: { label: 'Clicks delta', color: 'var(--accent)' } };

export function OutcomesEvidenceTable({ rows }: { rows: OutcomeEvidenceRow[] }) {
  // OutcomesSummary (above, same tab) already states this exact "no measured outcomes yet"
  // message. A second identical card here duplicated it for no reason — render nothing
  // instead of repeating the same empty state a third time on one page.
  if (rows.length === 0) {
    return null;
  }

  const distinctDates = new Set(rows.map((row) => row.outcomeMeasuredAt.toDateString()));
  const hasTrend = distinctDates.size >= 2;

  const trendData = [...rows]
    .sort((a, b) => a.outcomeMeasuredAt.getTime() - b.outcomeMeasuredAt.getTime())
    .map((row) => ({ date: formatDate(row.outcomeMeasuredAt), clicksDelta: row.clicksDelta }));

  const totalBaselineClicks = rows.reduce((sum, row) => sum + Math.max(row.clicksDelta * -1, 0), 0);
  const totalOutcomeClicksAggregate = rows.reduce((sum, row) => sum + Math.max(row.clicksDelta, 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {hasTrend ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Clicks delta over time</CardTitle>
            <p className="text-xs text-muted-foreground">Per measured change · clicks, outcome vs. baseline</p>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={trendChartConfig}
              className="h-40 w-full"
              role="img"
              aria-label={`Clicks delta over ${trendData.length} measured dates, outcome vs. baseline per change`}
            >
              <LineChart data={trendData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
                <Line type="monotone" dataKey="clicksDelta" stroke="var(--color-clicksDelta)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      ) : (
        <ComparisonBar
          label="Clicks, outcome vs. baseline (single measured window — not a sitewide total)"
          current={totalOutcomeClicksAggregate}
          previous={totalBaselineClicks}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Evidence record</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Page</th>
                <th className="py-2 pr-4">Action type</th>
                <th className="py-2 pr-4">Baseline</th>
                <th className="py-2 pr-4">Outcome</th>
                <th className="py-2 pr-4">Clicks Δ</th>
                <th className="py-2 pr-4">Impressions Δ</th>
                <th className="py-2 pr-4">Sample</th>
                <th className="py-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="max-w-[220px] truncate py-2 pr-4 font-mono text-xs text-foreground">{row.pageUrl}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{row.actionType}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{formatDate(row.baselineCapturedAt)}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{formatDate(row.outcomeMeasuredAt)}</td>
                  <td
                    className="py-2 pr-4"
                    style={{ color: row.clicksDelta >= 0 ? 'var(--dex-app-success)' : 'var(--dex-app-danger)' }}
                  >
                    {row.clicksDelta >= 0 ? '+' : ''}
                    {row.clicksDelta}
                  </td>
                  <td
                    className="py-2 pr-4"
                    style={{ color: row.impressionsDelta >= 0 ? 'var(--dex-app-success)' : 'var(--dex-app-danger)' }}
                  >
                    {row.impressionsDelta >= 0 ? '+' : ''}
                    {row.impressionsDelta}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{row.baselineSampleClicks} clicks</td>
                  <td className="py-2">
                    <a
                      href={`/api/actions/${row.id}/evidence`}
                      className="font-medium text-accent underline-offset-4 hover:underline"
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
