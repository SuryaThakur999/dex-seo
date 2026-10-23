// Real stored specialist/processing events only — every entry is a verbatim ScanLogLine
// message this codebase actually wrote during a real scan (run-scan.ts/scan-worker.ts), never
// a synthesized or fictional agent "conversation." Agent attribution reuses the exact same
// message-prefix matches scan-stages.ts already established for stage classification — no new
// pattern invented here, just a second read of the same real strings.

export interface EvidenceLedgerEntry {
  message: string;
  createdAt: Date;
  agent: string | null;
}

const AGENT_PATTERNS: [string, RegExp][] = [
  ['SEO Specialist', /^SEO Specialist recorded /],
  ['GEO Specialist', /^GEO Specialist recorded /],
  ['Brand Specialist', /^Brand Specialist recorded /],
  ['ProofLayer Validator', /^ProofLayer: /],
];

function matchAgent(message: string): string | null {
  for (const [agent, pattern] of AGENT_PATTERNS) {
    if (pattern.test(message)) return agent;
  }
  return null;
}

export function buildEvidenceLedger(logLines: { message: string; createdAt: Date }[]): EvidenceLedgerEntry[] {
  return logLines
    .map((line) => ({ message: line.message, createdAt: line.createdAt, agent: matchAgent(line.message) }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export interface AgentEvidenceSummaryRow {
  agent: string;
  detail: string;
  at: Date;
}

/**
 * Mission Control's compact bottom-row evidence strip — one real row per agent that actually
 * logged something this scan, using its own latest message and real timestamp. Never a
 * synthesized summary sentence; the row's "detail" is the agent's own real log text.
 */
export function buildAgentEvidenceSummary(entries: EvidenceLedgerEntry[]): AgentEvidenceSummaryRow[] {
  const latestByAgent = new Map<string, EvidenceLedgerEntry>();
  for (const entry of entries) {
    if (!entry.agent) continue;
    const existing = latestByAgent.get(entry.agent);
    if (!existing || entry.createdAt.getTime() > existing.createdAt.getTime()) {
      latestByAgent.set(entry.agent, entry);
    }
  }
  return Array.from(latestByAgent.entries()).map(([agent, entry]) => ({ agent, detail: entry.message, at: entry.createdAt }));
}

// The orchestrator's own consolidation work has no ScanLogLine of its own (it runs at render
// time over Finding rows, not during the scan write -- see opportunity-board.ts) -- but the
// count it produces is real, computed from this scan's actual findings, not a fabricated
// activity line. Returns null rather than a "0 combined" row when nothing was consolidated.
export function buildOrchestratorSummaryRow(consolidatedCount: number, at: Date): AgentEvidenceSummaryRow | null {
  if (consolidatedCount === 0) return null;
  return {
    agent: 'Growth Orchestrator',
    detail: `Consolidated ${consolidatedCount} overlapping finding${consolidatedCount === 1 ? '' : 's'} from this scan.`,
    at,
  };
}
