import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { VerifiedFixesData } from '@/lib/verified-on-rescan';

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function VerifiedFixesBlock({ data, loading }: { data: VerifiedFixesData | null; loading: boolean }) {
  return (
    <Card role="region" aria-label="Verified fixes">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Verified fixes</CardTitle>
        <CardDescription>
          Findings Dex confirmed fixed or excluded on a later scan -- works even without Search Console connected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <div aria-hidden="true" className="flex flex-col gap-2">
            <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-20 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : data === null || data.byRule.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No verified fixes yet -- Dex records one the next time a scan confirms an earlier finding was fixed or excluded.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-medium text-muted-foreground">Last 30 days</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{data.last30.count}</p>
                {data.last30.medianDaysToVerify !== null && (
                  <p className="text-xs text-muted-foreground">median {data.last30.medianDaysToVerify} day(s) to verify</p>
                )}
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-medium text-muted-foreground">Last 90 days</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{data.last90.count}</p>
                {data.last90.medianDaysToVerify !== null && (
                  <p className="text-xs text-muted-foreground">median {data.last90.medianDaysToVerify} day(s) to verify</p>
                )}
              </div>
            </div>
            <ul aria-label="Verified fixes by rule" className="flex flex-col gap-4">
              {data.byRule.map((group) => (
                <li key={group.ruleId} className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{group.ruleId}</span>
                    {group.rejectedAsFalsePositiveRate !== null && (
                      <span className="text-xs text-muted-foreground">
                        {formatPercent(group.rejectedAsFalsePositiveRate)} rejected as false positive
                      </span>
                    )}
                  </div>
                  <ul className="flex flex-col gap-2">
                    {group.rows.map((row) => (
                      <li key={`${row.pageUrl}-${row.resolvedAt}`} className="flex flex-col gap-0.5 text-xs">
                        <span className="break-words text-foreground">{row.pageUrl}</span>
                        <span className="text-muted-foreground">{row.proofLine}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
