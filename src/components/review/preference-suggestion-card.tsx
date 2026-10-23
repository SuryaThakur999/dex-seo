'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function formatSuggestionCopy(phrase: string, supportingEditCount: number): string {
  const draftWord = supportingEditCount === 1 ? 'draft' : 'drafts';
  return `Dex noticed a pattern — You removed "${phrase}" from ${supportingEditCount} ${draftWord}. Should Dex evaluate avoiding this phrase in future drafts?`;
}

interface Candidate {
  id: string;
  originalProposedPhrase: string;
  rationale: string;
  evidenceExcerpts: { auditLogEntryId: string; before: string; after: string }[];
  websiteUrl: string;
}

interface PreferenceSuggestionCardProps {
  checkWebsiteIds: string[];
  initialCandidate: Candidate | null;
}

export function PreferenceSuggestionCard({ checkWebsiteIds, initialCandidate }: PreferenceSuggestionCardProps) {
  const [candidate, setCandidate] = useState<Candidate | null>(initialCandidate);
  const [dismissed, setDismissed] = useState(false);
  const [evaluateSucceeded, setEvaluateSucceeded] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (candidate || checkWebsiteIds.length === 0) return;
    let cancelled = false;

    async function runChecks() {
      for (const websiteId of checkWebsiteIds) {
        try {
          const res = await fetch(`/api/websites/${websiteId}/preference-candidates/check`, { method: 'POST' });
          if (!res.ok) continue;
          const body = await res.json();
          if (!cancelled && body.outcome === 'candidate_created' && body.candidate) {
            setCandidate(body.candidate);
            return;
          }
        } catch {
          // Non-blocking by design -- a failed check silently leaves the Review page usable
          // with no suggestion shown, same as if nothing had been found.
        }
      }
    }

    runChecks();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(decision: 'evaluate' | 'reject') {
    if (!candidate) return;
    setDeciding(true);
    setError(null);
    try {
      const res = await fetch(`/api/preference-candidates/${candidate.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        setError('Something went wrong — try again.');
        return;
      }
      if (decision === 'evaluate') {
        setEvaluateSucceeded(true);
      } else {
        setDismissed(true);
      }
    } catch {
      setError('Something went wrong — try again.');
    } finally {
      setDeciding(false);
    }
  }

  if (!candidate || dismissed) return null;

  return (
    <Card className="border-accent/40">
      {evaluateSucceeded ? (
        <CardContent className="flex flex-col gap-2 pt-6">
          <p className="text-sm text-foreground">Quality check in progress</p>
          <p className="text-xs text-muted-foreground">
            Dex will compare this preference with future reviewed drafts. No action is needed. Your active preferences
            have not changed.
          </p>
        </CardContent>
      ) : (
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="text-sm text-foreground">{formatSuggestionCopy(candidate.originalProposedPhrase, candidate.evidenceExcerpts.length)}</p>
          <p className="text-xs text-muted-foreground">On {candidate.websiteUrl}</p>
          <p className="text-xs text-muted-foreground">Active preferences remain unchanged until Dex finishes evaluating.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide('evaluate')} disabled={deciding}>
              Evaluate this preference
            </Button>
            <Button size="sm" variant="outline" onClick={() => decide('reject')} disabled={deciding}>
              Not a preference
            </Button>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <button
            type="button"
            aria-expanded={showEvidence}
            aria-controls={`preference-evidence-${candidate.id}`}
            className="inline-flex min-h-11 items-center text-left text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setShowEvidence((v) => !v)}
          >
            {showEvidence ? 'Hide' : 'Why Dex suggested this'}
          </button>
          {showEvidence && (
            <div id={`preference-evidence-${candidate.id}`} className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
              {candidate.evidenceExcerpts.map((e) => (
                <div key={e.auditLogEntryId}>
                  <p className="text-muted-foreground line-through">{e.before}</p>
                  <p className="text-foreground">{e.after}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
