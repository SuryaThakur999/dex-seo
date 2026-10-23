import React from 'react';
import { CheckCircle } from '@phosphor-icons/react/dist/ssr';
import type { AgentEvidenceSummaryRow } from '@/lib/agent-evidence-ledger';

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Dashboard audit: these specialist names are job titles, not plain language -- lead with what
// each one actually checks, with the name kept small underneath instead of being the only label.
const PLAIN_AGENT_SUMMARY: Record<string, string> = {
  'SEO Specialist': 'Technical SEO check',
  'GEO Specialist': 'AI discoverability check',
  'Brand Specialist': 'Brand & wording check',
  'Growth Orchestrator': 'Coordinates the other checks',
};

/** Compact horizontal strip — one real row per agent, its own latest real log line. */
export function AgentEvidenceSummary({ rows }: { rows: AgentEvidenceSummaryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No agent activity recorded yet.</p>;
  }
  // Always rendered inside a narrow ~1/3-width card, not the full page — sm:grid-cols-3
  // fired off the viewport's width, not the card's, so three agent names got crammed into
  // ~90px each and truncated ("SEO Spec…", "Brand Sp…"). One column reads cleanly instead.
  return (
    <div className="grid grid-cols-1 gap-3">
      {rows.map((row) => (
        <div key={row.agent} className="flex items-start gap-2">
          <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-[var(--dex-app-success)]" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{PLAIN_AGENT_SUMMARY[row.agent] ?? row.agent}</p>
            <p className="truncate text-xs text-muted-foreground">{row.agent}</p>
            <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
            <p className="text-[10px] text-muted-foreground">{formatTime(row.at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
