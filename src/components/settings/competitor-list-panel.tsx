'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type CompetitorClassification = 'direct' | 'indirect' | 'adjacent' | 'unknown';

export interface CompetitorEntityItem {
  id: string;
  name: string;
  canonicalDomain: string | null;
  classification: CompetitorClassification;
  classificationReason: string;
  userConfirmed: boolean;
}

const CLASSIFICATION_OPTIONS: { value: CompetitorClassification; label: string }[] = [
  { value: 'direct', label: 'Direct' },
  { value: 'indirect', label: 'Indirect' },
  { value: 'adjacent', label: 'Adjacent' },
  { value: 'unknown', label: 'Unknown' },
];

function CompetitorRow({
  competitor, clientProfileId, onChanged, onRemoved,
}: {
  competitor: CompetitorEntityItem;
  clientProfileId: string;
  onChanged: (updated: CompetitorEntityItem) => void;
  onRemoved: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeClassification(classification: CompetitorClassification) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/client-profile/${clientProfileId}/competitors/${competitor.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classification }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong -- try again.');
        return;
      }
      onChanged(body.competitor);
    } catch {
      setError('Something went wrong -- try again.');
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/client-profile/${clientProfileId}/competitors/${competitor.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Something went wrong -- try again.');
        return;
      }
      onRemoved(competitor.id);
    } catch {
      setError('Something went wrong -- try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
      <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <span className="text-sm font-medium text-foreground">{competitor.name}</span>
        {competitor.canonicalDomain && (
          <span className="min-w-0 break-all text-xs text-muted-foreground sm:text-right">{competitor.canonicalDomain}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{competitor.classificationReason}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={competitor.classification} onValueChange={(v) => changeClassification(v as CompetitorClassification)}>
          <SelectTrigger className="h-11 w-40 sm:h-9" aria-label={`Classification for ${competitor.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={remove}>
          {`Remove ${competitor.name}`}
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function CompetitorListPanel({
  clientProfileId, initialCompetitors,
}: {
  clientProfileId: string;
  initialCompetitors: CompetitorEntityItem[];
}) {
  const [competitors, setCompetitors] = useState(initialCompetitors);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/client-profile/${clientProfileId}/competitors`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, canonicalDomain: domain || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong -- try again.');
        return;
      }
      setCompetitors((current) => [body.competitor, ...current]);
      setName('');
      setDomain('');
    } catch {
      setError('Something went wrong -- try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mt-6" role="region" aria-label="Competitors">
      <CardHeader>
        <CardTitle><h2>Competitors</h2></CardTitle>
        <CardDescription>
          Dex uses this list to find and grade market evidence from your competitors. Add one, or correct how Dex classified it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="competitorName" className="text-sm font-medium text-foreground">Competitor name</label>
            <input
              id="competitorName" name="name" type="text" required value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-[200px] rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="competitorDomain" className="text-sm font-medium text-foreground">Domain (optional)</label>
            <input
              id="competitorDomain" name="canonicalDomain" type="text" value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              className="min-w-[200px] rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <Button type="submit" variant="accent" disabled={pending || !name.trim()}>Add competitor</Button>
        </form>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {competitors.length > 0 && (
          <ul aria-label="Competitors" className="flex flex-col gap-4">
            {competitors.map((competitor) => (
              <CompetitorRow
                key={competitor.id}
                competitor={competitor}
                clientProfileId={clientProfileId}
                onChanged={(updated) => setCompetitors((current) => current.map((c) => (c.id === updated.id ? updated : c)))}
                onRemoved={(id) => setCompetitors((current) => current.filter((c) => c.id !== id))}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
