'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useDailyMission } from '@/hooks/use-daily-mission';

export function DailyMissionCard({ websiteId }: { websiteId: string }) {
  const { mission, error } = useDailyMission(websiteId);

  return (
    <Card role="region" aria-label="Daily mission">
      <CardContent className="flex min-h-24 flex-wrap items-center justify-between gap-4 py-5">
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
      </CardContent>
    </Card>
  );
}
