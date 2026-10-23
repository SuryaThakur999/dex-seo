'use client';

import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import type { OpportunityMapPoint } from '@/lib/opportunity-map';

const IMPACT_LABEL: Record<1 | 2 | 3, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };
// A scatter plot with 1-2 real dots and the rest "Not rated" reads as broken, not useful --
// wait for enough rated opportunities to show a real spread before rendering the chart.
const MIN_RATED_FOR_CHART = 3;

/**
 * Rule-based prioritization only — impact is the group's own worst real Finding.severity,
 * effort is its own real distinct-page count (see opportunity-map.ts). Never predicted
 * growth or an invented business-impact score.
 */
export function OpportunityMapChart({ points }: { points: OpportunityMapPoint[] }) {
  const rated = points.filter((p) => p.impact !== null) as (OpportunityMapPoint & { impact: 1 | 2 | 3 })[];
  const unrated = points.filter((p) => p.impact === null);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No open opportunities to map right now.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Rule-based prioritization — impact is each issue&apos;s worst real severity, effort is its real affected-page
        count. Not a growth or traffic prediction.
      </p>
      {rated.length >= MIN_RATED_FOR_CHART ? (
        <div className="h-[220px] w-full" role="img" aria-label="Opportunity map: impact by severity vs. effort by affected pages">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="effort"
                name="Effort (affected pages)"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="number"
                dataKey="impact"
                name="Impact (severity)"
                domain={[0.5, 3.5]}
                ticks={[1, 2, 3]}
                tickFormatter={(v: number) => IMPACT_LABEL[v as 1 | 2 | 3] ?? ''}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
              />
              <ZAxis type="number" dataKey="pageCount" range={[60, 300]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as OpportunityMapPoint | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-xs">
                      <p className="font-medium text-foreground">{p.issueLabel}</p>
                      <p className="text-muted-foreground">
                        {p.impact ? IMPACT_LABEL[p.impact] : 'Unrated'} impact · {p.effort} page{p.effort === 1 ? '' : 's'}
                      </p>
                    </div>
                  );
                }}
              />
              <Scatter data={rated} fill="var(--accent)" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        rated.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Not enough rated opportunities yet to map ({rated.length} of {MIN_RATED_FOR_CHART} needed).
          </p>
        )
      )}
      {unrated.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Not rated (no severity data)</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {unrated.map((p) => (
              <li key={p.key}>
                {p.issueLabel} — {p.effort} page{p.effort === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
