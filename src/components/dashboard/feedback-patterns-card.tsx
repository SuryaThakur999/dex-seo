'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DecisionBreakdown } from '@/lib/feedback-analysis-constants';
import { MIN_EDITS_FOR_SUMMARY } from '@/lib/feedback-analysis-constants';

export function describeEligibility(minEditsNeeded: number): string | null {
  if (minEditsNeeded <= 0) return null;
  const have = MIN_EDITS_FOR_SUMMARY - minEditsNeeded;
  return `Need at least ${MIN_EDITS_FOR_SUMMARY} edited drafts — you have ${have}.`;
}

export function formatProvenance(sourceEditCount: number, generatedAt: Date): string {
  const editWord = sourceEditCount === 1 ? 'edit' : 'edits';
  return `Based on ${sourceEditCount} ${editWord}, generated ${generatedAt.toLocaleDateString()}`;
}

// Per the design doc's exact wording ("N new edits since this analysis — refresh?"). Falls
// back to the count-free phrasing when the fingerprint went stale without the count actually
// growing (e.g. a revert+re-edit swaps one eligible edit for another rather than adding one).
export function formatStaleNotice(newEditCount: number): string {
  if (newEditCount <= 0) return 'New edits since this analysis — refresh?';
  const editWord = newEditCount === 1 ? 'edit' : 'edits';
  return `${newEditCount} new ${editWord} since this analysis — refresh?`;
}

interface CachedSummary {
  summary: string | null;
  sourceEditCount: number;
  generatedAt: Date;
  isStale: boolean;
  newEditCount: number;
}

interface FeedbackPatternsCardProps {
  websiteId: string;
  breakdown: DecisionBreakdown;
  cached: CachedSummary | null;
  minEditsNeeded: number;
}

export function FeedbackPatternsCard({ websiteId, breakdown, cached, minEditsNeeded }: FeedbackPatternsCardProps) {
  const [result, setResult] = useState(cached);
  const [loading, setLoading] = useState(false);
  const [needed, setNeeded] = useState(minEditsNeeded);
  const [error, setError] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/websites/${websiteId}/feedback-analysis`, { method: 'POST' });
      if (!res.ok) {
        setError(true);
        return;
      }
      const body = await res.json();
      if (body.belowThreshold) {
        setNeeded(body.needed);
        return;
      }
      setResult({
        summary: body.summary,
        sourceEditCount: body.sourceEditCount,
        generatedAt: new Date(body.generatedAt),
        isStale: false,
        newEditCount: 0,
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const eligibilityMessage = describeEligibility(needed);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-semibold text-foreground">{breakdown.totals.approved}</p>
          <p className="text-xs text-muted-foreground">Approved</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-semibold text-foreground">{breakdown.totals.rejected}</p>
          <p className="text-xs text-muted-foreground">Rejected</p>
        </div>
        <div className="rounded-lg border border-border p-3 text-center">
          <p className="text-2xl font-semibold text-foreground">{breakdown.totals.edited}</p>
          <p className="text-xs text-muted-foreground">Edited</p>
        </div>
      </div>

      {breakdown.byActionType.length > 0 && (
        <p className="text-xs text-muted-foreground">
          By type:{' '}
          {breakdown.byActionType.map((c, i) => (
            <span key={c.category}>
              {i > 0 && ', '}
              {c.category} ({c.count})
            </span>
          ))}
        </p>
      )}

      {result?.summary ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm text-foreground">{result.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatProvenance(result.sourceEditCount, result.generatedAt)}</p>
          {result.isStale && <p className="mt-1 text-xs text-amber-600">{formatStaleNotice(result.newEditCount)}</p>}
          <Button variant="outline" size="sm" className="mt-2" onClick={handleAnalyze} disabled={loading}>
            {loading ? 'Analyzing…' : 'Refresh analysis'}
          </Button>
          {error && <p className="mt-1 text-xs text-destructive">Something went wrong — try again.</p>}
        </div>
      ) : (
        <div>
          <Button size="sm" onClick={handleAnalyze} disabled={loading || needed > 0}>
            {loading ? 'Analyzing…' : 'Analyze my edits'}
          </Button>
          {eligibilityMessage && <p className="mt-1 text-xs text-muted-foreground">{eligibilityMessage}</p>}
          {error && <p className="mt-1 text-xs text-destructive">Something went wrong — try again.</p>}
        </div>
      )}
    </div>
  );
}
