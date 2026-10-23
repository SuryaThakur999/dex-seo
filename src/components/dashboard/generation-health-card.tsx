import React from 'react';
import type { GenerationHealth } from '@/lib/dashboard-stats';

/**
 * Only the two real GenerationStatus values (succeeded/failed) — no queued or rate-limited
 * row, since no persistent queue or rate-limit tracking exists anywhere in this codebase.
 * Rendering an empty "Queued 0" row would read as a real queue that simply has nothing in
 * it right now, which is not true — the capability itself doesn't exist yet.
 */
export function GenerationHealthCard({ health, tokensPerApprovedDraft }: { health: GenerationHealth; tokensPerApprovedDraft: number | null }) {
  const total = health.ready + health.failed;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--dex-app-success)]" aria-hidden />
          Ready
        </span>
        <span className="font-medium text-foreground">{health.ready}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--dex-app-danger)]" aria-hidden />
          Failed
        </span>
        <span className="font-medium text-foreground">{health.failed}</span>
      </div>
      {total === 0 && <p className="text-xs text-muted-foreground">No generations yet.</p>}
      <div className="border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">Tokens per approved draft</p>
        <p className="text-sm font-medium text-foreground">
          {tokensPerApprovedDraft === null ? 'Not measured yet — nothing approved in this window' : tokensPerApprovedDraft.toLocaleString()}
        </p>
      </div>
    </div>
  );
}
