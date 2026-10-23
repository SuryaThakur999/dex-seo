import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/dashboard-stats';

export interface ScanActivityJob {
  id: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  error: string | null;
  resultSummary?: unknown;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
};

export function ScanActivity({
  jobs,
  headerAction,
  statusMessage,
}: {
  jobs: ScanActivityJob[];
  headerAction?: ReactNode;
  statusMessage?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base font-medium">Scan activity</CardTitle>
        {headerAction}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {statusMessage}
        {jobs.length === 0 && <p className="text-sm text-muted-foreground">No scans yet. Run your first scan above.</p>}
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
          >
            <div className="flex items-center gap-2">
              {job.status === 'running' && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
              )}
              <Badge variant={STATUS_VARIANT[job.status] ?? 'outline'}>{STATUS_LABEL[job.status] ?? job.status}</Badge>
              {job.status === 'failed' && job.error && (
                <span className="line-clamp-1 text-xs text-muted-foreground">{job.error}</span>
              )}
            </div>
            <time
              dateTime={(job.completedAt ?? job.createdAt).toISOString()}
              title={(job.completedAt ?? job.createdAt).toLocaleString()}
              className="text-xs text-muted-foreground"
            >
              {formatRelativeTime(job.completedAt ?? job.createdAt)}
            </time>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
