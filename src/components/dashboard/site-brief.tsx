import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/dashboard-stats';

export interface SiteBriefCrawl {
  attempted: number | undefined;
  scanned: number;
  budget: number;
}

type GscStatus = 'connected' | 'not_connected' | 'property_pending' | 'reconnect_required';

const GSC_LABEL: Record<GscStatus, string> = {
  connected: 'Search Console connected',
  not_connected: 'Search Console not connected',
  property_pending: 'Search Console connected — property not selected',
  reconnect_required: 'Search Console needs reconnecting',
};

export function SiteBrief({
  websiteUrl,
  clientProfileName,
  lastAuditAt,
  lastAuditStatus,
  gscStatus,
  crawl,
  brandFacts,
}: {
  websiteUrl: string;
  clientProfileName: string;
  lastAuditAt: Date | null;
  lastAuditStatus: string | null;
  gscStatus: GscStatus;
  crawl: SiteBriefCrawl | null;
  brandFacts: string[];
}) {
  // Attempted is unknown for a resultSummary written before this field existed — show a
  // real count either way, but never invent the couldn't-check figure from a missing value.
  const couldntCheck = crawl?.attempted !== undefined ? crawl.attempted - crawl.scanned : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Site brief</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-medium text-foreground">{websiteUrl}</span>
          <span className="text-xs text-muted-foreground">{clientProfileName}</span>
        </div>

        <p className="text-xs text-muted-foreground">
          {lastAuditAt
            ? `Last audit ${formatRelativeTime(lastAuditAt)}${lastAuditStatus && lastAuditStatus !== 'completed' ? ` (${lastAuditStatus})` : ''}`
            : 'No audit run yet'}
        </p>

        <p className="text-xs text-muted-foreground">{GSC_LABEL[gscStatus]}</p>

        {crawl && (
          <p className="text-xs text-muted-foreground">
            Checked {crawl.scanned}
            {crawl.attempted !== undefined ? ` of ${crawl.attempted} attempted` : ''}
            {couldntCheck !== undefined && couldntCheck > 0 ? ` · ${couldntCheck} couldn't be read` : ''} · budget{' '}
            {crawl.budget} pages/scan
          </p>
        )}

        {brandFacts.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Confirmed brand facts</span>
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {brandFacts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
