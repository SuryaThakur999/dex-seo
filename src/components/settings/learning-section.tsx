import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ActivationToggle } from './activation-toggle';

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Pending',
  approved_for_evaluation: 'Evaluating',
  rejected: 'Not a preference',
  superseded: 'Replaced by a newer suggestion',
};

export function formatCandidateStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

const EVALUATION_STATUS_LABEL: Record<string, string> = {
  pending: 'Quality check in progress',
  evaluating: 'Quality check in progress',
  insufficient_evidence: 'More evidence needed',
  passed: 'Quality check passed — ready for activation',
  failed: 'Quality check did not pass',
};

export function formatEvaluationStatusLabel(status: string): string {
  return EVALUATION_STATUS_LABEL[status] ?? status;
}

export interface CandidateRow {
  id: string;
  originalProposedPhrase: string;
  customerEditedPhrase: string | null;
  status: string;
  generatedAt: Date;
  websiteUrl: string;
  evaluationStatus: string | null;
  evaluatedPhrase: string | null;
  isActive: boolean;
}

export function LearningSection({ candidates }: { candidates: CandidateRow[] }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Learning</CardTitle>
        <CardDescription>
          Suggested preferences Dex has noticed from your edits. Active preferences remain unchanged until a suggestion
          finishes evaluating.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet — Dex hasn&apos;t noticed a repeated pattern in your edits.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 rounded-md border border-border p-3 text-sm">
                <div className="min-w-0">
                  <span className="text-foreground">&quot;{c.customerEditedPhrase ?? c.originalProposedPhrase}&quot;</span>
                  <p className="text-xs text-muted-foreground">{c.websiteUrl}</p>
                </div>
                {c.status === 'approved_for_evaluation' && c.evaluationStatus === 'passed' ? (
                  <ActivationToggle candidateId={c.id} initialActive={c.isActive} />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {c.status === 'approved_for_evaluation' && c.evaluationStatus
                      ? formatEvaluationStatusLabel(c.evaluationStatus)
                      : formatCandidateStatusLabel(c.status)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
