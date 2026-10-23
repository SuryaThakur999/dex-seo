// Backward-compatible adapter over the existing Finding row -- not a schema change. Finding
// already carries everything real this envelope needs; this only reshapes it into the wider
// contract Phase 7A calls for, honestly marking what this codebase doesn't track yet
// (language/market: 'not_evaluated', no fabricated model/prompt version).

export interface NormalizedAgentResult {
  findingId: string;
  agentId: string;
  // Static 'v1' today, same convention as Finding.ruleVersion and Action.policyVersion
  // elsewhere in this codebase -- not a real tracked version yet, honestly a placeholder
  // until agents are actually versioned independently (Phase 7B).
  agentVersion: string;
  ruleId: string;
  ruleVersion: string;
  affectedUrl: string;
  // The Finding row itself IS the stable evidence identity -- its evidence JSON never changes
  // after creation, so the row's own id is a valid reference, not a separate lookup needed.
  evidenceRef: string;
  severity: 'low' | 'medium' | 'high';
  confidence: 'high' | 'medium' | 'low';
  confidenceBasis: string;
  rationale: string;
  recommendedAction: string;
  limitations: string | null;
  // No citation-tracking exists anywhere in this codebase yet -- honestly empty, never invented.
  citations: string[];
  language: 'not_evaluated';
  market: 'not_evaluated';
  // Omitted (not set to a guessed value) for every current agent -- none of the four audit
  // agents call a model; only Content Studio's separate generation path does, and that's a
  // different result shape entirely, not a Finding.
  modelVersion?: string;
  promptVersion?: string;
  timestamp: string;
}

interface FindingLike {
  id: string;
  agent: string;
  ruleId: string;
  ruleVersion: string;
  pageUrl: string;
  severity: 'low' | 'medium' | 'high';
  confidence: string;
  suggestedAction: string;
  limitations: string | null;
  retrievedAt?: Date;
  createdAt: Date;
}

export function normalizeFinding(finding: FindingLike): NormalizedAgentResult {
  return {
    findingId: finding.id,
    agentId: finding.agent,
    agentVersion: 'v1',
    ruleId: finding.ruleId,
    ruleVersion: finding.ruleVersion,
    affectedUrl: finding.pageUrl,
    evidenceRef: finding.id,
    severity: finding.severity,
    confidence: (finding.confidence as 'high' | 'medium' | 'low') ?? 'medium',
    // A finding with real limitations text is pattern-matched/heuristic evidence; one without
    // is a deterministic DOM/HTTP check. This is derived from what the agent itself already
    // recorded, not a separate guessed classification.
    confidenceBasis: finding.limitations ? 'Pattern-matched evidence; see limitations.' : 'Deterministic check against collected crawl evidence.',
    rationale: `Rule ${finding.ruleId} matched based on evidence collected for ${finding.pageUrl}.`,
    recommendedAction: finding.suggestedAction,
    limitations: finding.limitations,
    citations: [],
    language: 'not_evaluated',
    market: 'not_evaluated',
    timestamp: (finding.retrievedAt ?? finding.createdAt).toISOString(),
  };
}
