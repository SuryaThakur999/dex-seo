import React from 'react';
import type { ChangeLifecycleStage } from '@/lib/change-lifecycle';

/** Real per-change stage progression (see change-lifecycle.ts) — every dot reflects a real column. */
export function ChangeLifecycle({ stages }: { stages: ChangeLifecycleStage[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
      {stages.map((stage, i) => (
        <li key={stage.key} className="flex items-center gap-1">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
              stage.reached ? 'border-[var(--dex-app-success)] bg-[var(--dex-app-success)]' : 'border-border'
            }`}
            aria-hidden
          />
          <span className={stage.reached ? 'text-foreground' : 'text-muted-foreground'}>
            <span className="sr-only">{stage.reached ? 'Reached: ' : 'Not yet reached: '}</span>
            {stage.label}
            {stage.detail ? ` (${stage.detail})` : ''}
          </span>
          {i < stages.length - 1 && <span className="mx-1 text-muted-foreground">→</span>}
        </li>
      ))}
    </ol>
  );
}
