'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CompetitorWatchItem } from '@/lib/competitor-watch';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function CompetitorWatchCard({
  clientProfileId,
  websiteId,
  watchedNames = [],
}: {
  clientProfileId: string;
  websiteId: string;
  watchedNames?: string[];
}) {
  const settingsHref = `/settings?websiteId=${encodeURIComponent(websiteId)}`;
  const [items, setItems] = useState<CompetitorWatchItem[] | null>(null);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function load(signal?: AbortSignal) {
    try {
      const response = await fetch(`/api/client-profile/${encodeURIComponent(clientProfileId)}/competitor-watch`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Competitor watch request failed');
      const data: { items: CompetitorWatchItem[] } = await response.json();
      setItems(data.items);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [clientProfileId]);

  async function handleCheckNow() {
    if (checking) return;
    setChecking(true);
    try {
      await fetch(`/api/client-profile/${encodeURIComponent(clientProfileId)}/competitor-watch/check-now`, { method: 'POST' });
      await load();
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card role="region" aria-label="Competitor watch">
      <CardHeader>
        <CardTitle className="text-base font-medium">Competitors this week</CardTitle>
      </CardHeader>
      <CardContent className={items === null && !error ? 'min-h-24 pt-0' : 'pt-0'}>
        {error && <p role="alert" className="text-sm text-foreground">{"Couldn't load competitor changes. We'll try again shortly."}</p>}
        {items === null && !error && <p role="status" className="text-sm text-muted-foreground">Loading competitor changes</p>}
        {items?.length === 0 && (
          <div className="flex flex-col gap-2">
            {watchedNames.length > 0 && (
              <p className="text-sm text-foreground">Watching {watchedNames.length}: {watchedNames.join(', ')}</p>
            )}
            <p className="text-sm text-muted-foreground">No changes yet. Dex checks every Monday.</p>
            <div className="flex flex-wrap gap-3">
              <a href={settingsHref} className="text-xs font-medium text-accent underline-offset-4 hover:underline">
                {watchedNames.length > 0 ? 'Edit competitors' : 'Add competitors'}
              </a>
              <button type="button" onClick={handleCheckNow} disabled={checking} className="text-xs font-medium text-accent underline-offset-4 hover:underline disabled:opacity-50">
                {checking ? 'Checking…' : 'Check now'}
              </button>
            </div>
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{item.competitorName}</span>
                  <time dateTime={item.retrievedAt} className="text-xs text-muted-foreground">
                    {dateFormatter.format(new Date(item.retrievedAt))}
                  </time>
                </div>
                <p className="text-sm text-muted-foreground" title={item.canonicalUrl}>{item.excerpt}</p>
                <a
                  href={`/studio?websiteId=${encodeURIComponent(websiteId)}&topic=${encodeURIComponent(`Respond to ${item.competitorName}'s recent site update`)}&sourceEvidenceId=${encodeURIComponent(item.id)}`}
                  className="mt-1 w-fit text-xs font-medium text-accent underline-offset-4 hover:underline"
                >
                  Respond with a post
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
