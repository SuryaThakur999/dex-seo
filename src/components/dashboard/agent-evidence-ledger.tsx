import React from 'react';
import type { EvidenceLedgerEntry } from '@/lib/agent-evidence-ledger';

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Real stored specialist/processing events (ScanLogLine rows from the latest scan) — every
 * line is a verbatim message this codebase actually wrote, never a synthesized conversation.
 */
export function AgentEvidenceLedger({ entries }: { entries: EvidenceLedgerEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No scan activity recorded yet.</p>;
  }
  return (
    <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto text-sm">
      {entries.map((entry, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">{formatTime(entry.createdAt)}</span>
          <span className="text-foreground">
            {entry.agent && <span className="font-medium text-accent">{entry.agent}: </span>}
            {entry.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
