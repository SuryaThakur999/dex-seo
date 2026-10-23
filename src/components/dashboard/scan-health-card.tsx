'use client';

import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { DeltaBadge } from '@/components/dashboard/delta-badge';
import { Sparkline } from '@/components/dashboard/sparkline';
import { formatRelativeTime, type ActivityDay } from '@/lib/dashboard-stats';

export function ScanHealthCard({
  websiteUrl,
  pagesScanned,
  pendingCount,
  activity,
  gscConnected,
  delta,
  updatedAt,
}: {
  websiteUrl: string;
  pagesScanned: number;
  pendingCount: number;
  activity: ActivityDay[];
  gscConnected: boolean;
  delta?: number | null;
  updatedAt?: Date | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-muted-foreground">{websiteUrl}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-foreground">{pagesScanned}</span>
            <span className="text-sm text-muted-foreground">pages scanned</span>
            <DeltaBadge delta={delta} />
          </div>
          {updatedAt && <p className="mt-0.5 text-xs text-muted-foreground">Updated {formatRelativeTime(updatedAt)}</p>}
          <div className="mt-4 w-full max-w-xs">
            <Sparkline data={activity} dataKey="scans" />
          </div>
        </div>

        <div className="flex gap-6 sm:flex-col sm:gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Pending review</span>
            <span className="text-lg font-semibold text-foreground">{pendingCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {gscConnected ? (
              <CheckCircle size={16} weight="fill" className="text-[var(--dex-app-success)]" aria-hidden="true" />
            ) : (
              <XCircle size={16} weight="fill" className="text-[var(--dex-app-danger)]" aria-hidden="true" />
            )}
            <span className="text-xs text-muted-foreground">
              {gscConnected ? 'Search Console connected' : 'Not connected'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
