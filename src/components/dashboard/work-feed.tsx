'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';

interface WorkFeedItem {
  scanId: string;
  timestamp: string;
  status: ScanStatus;
  findingCount: number;
  findings: { id: string; ruleId: string; severity: 'low' | 'medium' | 'high' }[];
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function ruleIdLabel(ruleId: string): string {
  return ruleId.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
const statusLabels: Record<ScanStatus, string> = {
  queued: 'Queued', running: 'Running', completed: 'Completed',
  failed: 'Failed', cancelled: 'Cancelled', unknown: 'Unknown',
};
const statusVariants: Record<ScanStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline', running: 'secondary', completed: 'default',
  failed: 'destructive', cancelled: 'outline', unknown: 'outline',
};

export function RealWorkFeed({ websiteId }: { websiteId: string }) {
  const [items, setItems] = useState<WorkFeedItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let inFlight = false;
    setItems(null);
    setError(false);

    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/dashboard/work-feed?websiteId=${encodeURIComponent(websiteId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Work feed request failed');
        const data: WorkFeedItem[] = await response.json();
        if (!disposed) {
          setItems(data);
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        inFlight = false;
      }
    }

    void load();
    const interval = setInterval(() => { void load(); }, 30_000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [websiteId]);

  return (
    <Card id="work-feed" role="region" aria-label="Work feed">
      <CardHeader>
        <CardTitle className="text-base font-medium">Work feed</CardTitle>
      </CardHeader>
      <CardContent className="min-h-24 pt-0">
        {error && <p role="alert" className="mb-3 text-sm text-foreground">{"Couldn't load the work feed. We'll try again shortly."}</p>}
        {items === null && !error && <p role="status" className="text-sm text-muted-foreground">Loading work feed</p>}
        {items?.length === 0 && <p className="text-sm text-muted-foreground">No scans yet. Run an audit to start your work feed.</p>}
        {items && items.length > 0 && (
          <ol className="space-y-3">
            {items.map(item => (
              <li key={item.scanId} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariants[item.status]} className="text-xs">{statusLabels[item.status]}</Badge>
                    <span className="text-sm text-foreground">{item.findingCount} finding{item.findingCount === 1 ? '' : 's'}</span>
                  </div>
                  <time dateTime={item.timestamp} className="text-sm tabular-nums text-muted-foreground">
                    {dateFormatter.format(new Date(item.timestamp))}
                  </time>
                </div>
                {item.findings.length > 0 && (
                  <ul className="space-y-1 pl-1">
                    {item.findings.slice(0, 3).map((finding) => (
                      <li key={finding.id} className="text-sm text-muted-foreground">
                        {ruleIdLabel(finding.ruleId)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
