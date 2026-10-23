'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDailyMission } from '@/hooks/use-daily-mission';
import type { TodayCardProps } from './today-card-types';

export function TodayCard({ websiteId, pendingReviewCount, competitorChangeCount, postIdeaCount, summary }: TodayCardProps) {
  const { mission, error } = useDailyMission(websiteId);

  // pendingReviewCount is deliberately NOT a row here -- the mission button below already
  // states that count ("Review N changes"); a second row would repeat it (spec rule 3: no
  // duplicate count, 2026-10-16 overseer polish pass).
  const rows = [
    competitorChangeCount > 0 ? { href: '#competitors-and-ideas', label: `${competitorChangeCount} competitor change${competitorChangeCount === 1 ? '' : 's'}` } : null,
    postIdeaCount > 0 ? { href: '#competitors-and-ideas', label: `${postIdeaCount} post idea${postIdeaCount === 1 ? '' : 's'}` } : null,
  ].filter((r): r is { href: string; label: string } => r !== null);

  return (
    <Card role="region" aria-label="Today">
      <CardContent className="flex flex-col gap-4 py-5">
        {summary && <div className="text-sm text-muted-foreground">{summary}</div>}
        {rows.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <li key={row.label}>
                <a href={row.href} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">{row.label}</a>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          {error ? (
            <p role="alert" className="text-sm text-foreground">{"Couldn't load your next mission. Refresh to try again."}</p>
          ) : mission ? (
            <>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">{mission.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{mission.description}</p>
              </div>
              <Button asChild variant="accent" className="h-11 shrink-0">
                <Link href={mission.ctaHref}>{mission.cta}</Link>
              </Button>
            </>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">Loading your next mission</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
