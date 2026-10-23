import type { OpportunityGroup } from './opportunity-board';

export interface OpportunityMapPoint {
  key: string;
  issueLabel: string;
  /** Real Finding.severity rank (1=low..3=high), or null when no severity exists (Action-only groups). */
  impact: 1 | 2 | 3 | null;
  /** Real distinct-page count for the group — the transparent effort proxy: more affected
   * pages means more pages to review and approve, not a predicted-growth estimate. */
  effort: number;
  pageCount: number;
}

const SEVERITY_TO_IMPACT: Record<'low' | 'medium' | 'high', 1 | 2 | 3> = { low: 1, medium: 2, high: 3 };

/**
 * Rule-based prioritization only — never predicted growth or invented business impact.
 * Impact = the group's own worst real Finding.severity (null when the group has no severity
 * data at all, e.g. an Action-only group). Effort = the group's own real distinct-page count.
 * Both axes are already-computed fields on OpportunityGroup — no new data collection needed.
 */
export function computeOpportunityMapPoints(groups: OpportunityGroup[]): OpportunityMapPoint[] {
  return groups.map((g) => ({
    key: g.key,
    issueLabel: g.issueLabel,
    impact: g.severity ? SEVERITY_TO_IMPACT[g.severity] : null,
    effort: g.pageCount,
    pageCount: g.pageCount,
  }));
}
