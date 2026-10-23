import React from 'react';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { ProofCheckResult } from '@/lib/proof-layer';

// One real label per check name this codebase actually produces (proof-layer.ts's 6 shared
// checks plus Content Studio's one structural policy check) — an unrecognized name falls back to
// its raw string rather than a made-up label, matching seo-findings-panel.tsx's own precedent.
const CHECK_LABELS: Record<string, string> = {
  'ai-content-disclosure': 'AI disclosure',
  'no-unverifiable-claims': 'Verified claims',
  'no-contradiction': 'No contradictions',
  'length-format': 'Length & format',
  'duplicate-risk': 'Duplicate check',
  'no-restricted-wording': 'Brand wording',
  'reddit-target-community': 'Platform rules',
};

/**
 * Renders the real ProofCheckResult[] persisted on a ContentPiece — never a fixed checklist
 * unrelated to what was actually run. `null` (format validation never reached the proof layer)
 * and `[]` (no checks somehow ran) both render the same honest "not yet checked" state.
 */
export function ProofShield({ checks }: { checks: ProofCheckResult[] | null }) {
  if (!checks || checks.length === 0) {
    return <p className="text-sm text-muted-foreground">Not yet checked against your evidence and guidelines.</p>;
  }
  const passed = checks.filter((c) => c.result === 'pass').length;
  const failed = checks.length - passed;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">
        {failed === 0
          ? `All ${checks.length} checks passed`
          : `${passed} of ${checks.length} checks passed — ${failed} need${failed === 1 ? 's' : ''} your review`}
      </p>
      <ul className="flex flex-col gap-1">
        {checks.map((c) => (
          <li key={c.check} className="flex items-start gap-2 text-sm">
            {c.result === 'pass' ? (
              <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
            ) : (
              <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-destructive" aria-hidden />
            )}
            <span>
              <span className="font-medium text-foreground">{CHECK_LABELS[c.check] ?? c.check}</span>
              <span className="text-muted-foreground"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
