import { TrendUp, TrendDown, Minus } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OutcomesSummary as OutcomesSummaryData } from '@/lib/dashboard-stats';

export function OutcomesSummary({ data }: { data: OutcomesSummaryData }) {
  if (data.measuredCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Outcomes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No measured outcomes yet — GSC results appear here 28 days after an approved change.
          </p>
        </CardContent>
      </Card>
    );
  }

  const winRate = Math.round((data.winCount / data.measuredCount) * 100);
  const clicksPositive = data.totalClicksDelta > 0;
  const clicksNegative = data.totalClicksDelta < 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Outcomes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-foreground">{winRate}%</span>
          <span className="text-sm text-muted-foreground">
            win rate across {data.measuredCount} measured change{data.measuredCount === 1 ? '' : 's'}
            {data.measuredCount < 5 ? ' — small sample' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {clicksPositive ? (
            <TrendUp size={16} weight="bold" className="text-[var(--dex-app-success)]" aria-hidden="true" />
          ) : clicksNegative ? (
            <TrendDown size={16} weight="bold" className="text-[var(--dex-app-danger)]" aria-hidden="true" />
          ) : (
            <Minus size={16} weight="bold" className="text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-foreground">
            {clicksPositive ? '+' : ''}
            {data.totalClicksDelta} clicks, {data.totalImpressionsDelta >= 0 ? '+' : ''}
            {data.totalImpressionsDelta} impressions combined across {data.measuredCount} measured page
            {data.measuredCount === 1 ? '' : 's'} — not a sitewide total
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
