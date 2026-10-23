import { consolidateFindings, buildDecisionRecord, type DecisionRecord } from '@/lib/agent-orchestrator';
import { actionTypeLabel, actionTypePlainSummary } from '@/components/review/action-detail';
import {
  CANONICAL_FIX_RULE_IDS,
  CANONICAL_FIX_ACTION_TYPE,
  STRUCTURED_DATA_FIX_RULE_IDS,
  STRUCTURED_DATA_FIX_ACTION_TYPE,
  ENTITY_MARKUP_FIX_RULE_IDS,
  ENTITY_MARKUP_FIX_ACTION_TYPE,
} from '@/lib/deterministic-remediation';
import { RESTRICTED_WORDING_FIX_RULE_IDS, RESTRICTED_WORDING_FIX_ACTION_TYPE } from '@/lib/restricted-wording-fix';
import { INTERNAL_LINK_FIX_RULE_IDS, INTERNAL_LINK_FIX_ACTION_TYPE } from '@/lib/internal-link-fix';

// Consolidates the two separate lists Mission Control used to show side by side
// ("Needs your attention" for Action drafts, "Website findings" for raw Findings) into one
// evidence-backed Opportunity Board, grouped by issue type — DEX CONTINUATION MASTER
// DIRECTIVE Phase 2: "Group repeated template-level problems... instead of showing many
// visually identical rows." Only fields that exist today feed this; Locale is deliberately
// omitted (no per-website language/market field exists yet — that's Phase 6, not yet built),
// and ProofLayer stays null for Finding-only groups (no draft exists yet to check).

export type OpportunityStatus = 'found' | 'draft_ready' | 'needs_review' | 'failed';
export type OpportunityProofLayer = 'passed' | 'needs_review' | 'blocked' | null;

export interface OpportunityGroup {
  key: string;
  issueLabel: string;
  pageCount: number;
  status: OpportunityStatus;
  proofLayer: OpportunityProofLayer;
  /** One representative page URL, for a single-page group's link target. */
  samplePageUrl: string;
  /**
   * Real Finding.severity, worst-in-group (same "group is only as good as its worst member"
   * rule already used for status) — null for Action-only groups (meta_description drafts have
   * no severity field anywhere in the schema), never a guessed default.
   */
  severity: 'low' | 'medium' | 'high' | null;
  /**
   * Present on Finding-derived groups so the board can show which agent(s) actually produced
   * this opportunity and let the user expand into the real evidence behind it. Capped at
   * MAX_CONTRIBUTORS_SHOWN — this is a display list, not an audit trail.
   */
  contributors?: { id?: string; agent: string; ruleId: string; pageUrl: string; evidence: unknown; suggestedAction: string; limitations: string | null }[];
  /** Set only when the Growth Orchestrator merged two agents' findings into this one opportunity. */
  consolidationReason?: string;
  /** Set only on consolidated groups — the full council record backing that consolidation. */
  decisionRecord?: DecisionRecord;
  /**
   * Phase 1F: set only for the 4 rule IDs the design doc classified "human decision required" or
   * "informational/non-actionable" (docs/superpowers/specs/2026-09-25-phase1f-finding-to-action-
   * coverage-design.md) -- the real reason no generator exists for this row, so a customer sees
   * "no auto-fix, here's why" instead of a bare unexplained "Found" status next to every other
   * row that now DOES have a fix path. Never set for a rule that has a real Action generator.
   */
  noAutoFixReason?: string;
  /**
   * Phase 2G: set only on a ContentRecommendation-derived group. proofLayer/severity stay null
   * for these -- neither concept exists for a recommendation (no draft, no Finding severity).
   */
  recommendation?: {
    id: string;
    confidenceLabel: 'verified_market_development' | 'repeated_discussion' | 'insufficient_evidence';
    whyNow: string;
    businessRelevance: string;
    angle: string;
  };
  /**
   * Item 2 (overseer production check, 2026-10-16): set only on an Action-type group, whose
   * issueLabel is now the plain-language summary (e.g. "Tell Google which page is the main
   * one") -- this carries the existing technical term (e.g. "Canonical tag fix") to show small
   * underneath it, same pattern ActionDetail already uses for a single action. Unset for a
   * Finding/consolidated/recommendation group: those issueLabels are already plain language,
   * with no second technical term to show.
   */
  technicalLabel?: string;
}

interface RecommendationForGrouping {
  id: string;
  topic: string;
  confidenceLabel: 'verified_market_development' | 'repeated_discussion' | 'insufficient_evidence';
  whyNow?: string;
  businessRelevance?: string;
  angle?: string;
  websiteId: string;
  pageUrl: string | null;
}

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  found: 'Found',
  draft_ready: 'Draft ready',
  needs_review: 'Needs review',
  failed: 'Draft failed',
};

// Never a bare "Passed" floating alone — always read under the "ProofLayer" column header,
// same treatment as the design reference (Phase 2: "Label what passed, for example
// 'Draft passed ProofLayer'").
export const OPPORTUNITY_PROOFLAYER_LABEL: Record<Exclude<OpportunityProofLayer, null>, string> = {
  passed: 'Passed',
  needs_review: 'Needs review',
  blocked: 'Blocked',
};

const RULE_ISSUE_LABEL: Record<string, string> = {
  missing_canonical: 'Missing canonical',
  invalid_canonical: 'Invalid canonical',
  canonical_points_elsewhere: 'Canonical points elsewhere',
  missing_structured_data: 'Missing structured data',
  zero_internal_links: 'No internal links',
  ai_crawlers_blocked: 'AI crawlers blocked',
  missing_entity_markup: 'Missing entity markup',
  unverified_claim_candidate: 'Unverified claim',
  broken_page_status: 'Broken page',
};

// Phase 1F: the 4 rule IDs with no generator, each with the real reason already established when
// they were classified -- never a made-up justification. canonical_points_elsewhere closely
// follows seo-specialist.ts's own `limitations` text for that Finding; ai_crawlers_blocked and
// unverified_claim_candidate follow their `suggestedAction` text (geo-specialist.ts/
// brand-specialist.ts) and the Phase 1F design doc's stated classification reason;
// broken_page_status matches the design doc's own canonical example directly.
// Overseer polish (2026-10-16): only this one Finding-derived rule has a non-plain-language
// name today -- the others in RULE_ISSUE_LABEL already read fine to a customer. Adding one here
// shows its technical name small underneath, same pattern an Action group already uses.
const FINDING_PLAIN_LABEL: Record<string, string> = {
  unverified_claim_candidate: 'Claims Dex could not verify',
};

const NO_AUTOFIX_REASON: Record<string, string> = {
  canonical_points_elsewhere:
    'A non-self canonical can be intentional (e.g. a tracked duplicate) — only you know if this is right for this page.',
  unverified_claim_candidate:
    "Verifying a business claim is true is a judgment only you can make — confirm it, then add it to Customer Facts so future drafts can cite it.",
  ai_crawlers_blocked:
    'Blocking AI crawlers can be a deliberate choice (e.g. protecting proprietary content) — review whether this was intentional before changing it.',
  broken_page_status: "Dex can't know why this page is down and has no server access to fix it — check the page directly.",
};

// Phase 1F: once an Action exists for a page (deterministic-remediation or, as of
// restricted_wording_fix, an LLM draft), the Finding that produced it is represented by the
// Action group instead (draft_ready/needs_review, not a bare "found" with no path forward) --
// without this, the same real issue would show as two contradictory rows (an actioned group AND
// a still-"found" group) since Finding and Action have no findingId link to dedupe on directly
// (see Phase 1D's tracked gap).
const RULE_ID_TO_ACTION_TYPE: Record<string, string> = {
  ...Object.fromEntries(CANONICAL_FIX_RULE_IDS.map((ruleId) => [ruleId, CANONICAL_FIX_ACTION_TYPE])),
  ...Object.fromEntries(STRUCTURED_DATA_FIX_RULE_IDS.map((ruleId) => [ruleId, STRUCTURED_DATA_FIX_ACTION_TYPE])),
  ...Object.fromEntries(ENTITY_MARKUP_FIX_RULE_IDS.map((ruleId) => [ruleId, ENTITY_MARKUP_FIX_ACTION_TYPE])),
  ...Object.fromEntries(RESTRICTED_WORDING_FIX_RULE_IDS.map((ruleId) => [ruleId, RESTRICTED_WORDING_FIX_ACTION_TYPE])),
  ...Object.fromEntries(INTERNAL_LINK_FIX_RULE_IDS.map((ruleId) => [ruleId, INTERNAL_LINK_FIX_ACTION_TYPE])),
};

interface ActionForGrouping {
  pageUrl: string;
  actionType: string;
  guardResult: { outcome: string } | null;
  generationStatus: string;
}

interface FindingForGrouping {
  id: string;
  pageUrl: string;
  ruleId: string;
  agent: string;
  severity: 'low' | 'medium' | 'high';
  evidence: unknown;
  suggestedAction: string;
  limitations: string | null;
}

const SEVERITY_RANK: Record<'low' | 'medium' | 'high', number> = { low: 1, medium: 2, high: 3 };
const MAX_CONTRIBUTORS_SHOWN = 5;

function worstSeverity(findings: { severity: 'low' | 'medium' | 'high' }[]): 'low' | 'medium' | 'high' | null {
  if (findings.length === 0) return null;
  return findings.reduce((worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst), findings[0].severity);
}

function actionGroupStatus(actions: ActionForGrouping[]): { status: OpportunityStatus; proofLayer: OpportunityProofLayer } {
  // A group is only as good as its worst member — one failed draft in a group of otherwise-
  // ready ones still means the group needs a look, not a false "ready" summary.
  if (actions.some((a) => a.generationStatus === 'failed')) return { status: 'failed', proofLayer: null };
  const outcomes = actions.map((a) => a.guardResult?.outcome).filter((o): o is string => Boolean(o));
  if (outcomes.includes('block')) return { status: 'needs_review', proofLayer: 'blocked' };
  if (outcomes.includes('flag')) return { status: 'needs_review', proofLayer: 'needs_review' };
  if (outcomes.length > 0 && outcomes.every((o) => o === 'pass')) return { status: 'draft_ready', proofLayer: 'passed' };
  return { status: 'draft_ready', proofLayer: null };
}

export function computeOpportunityGroups(
  actions: ActionForGrouping[],
  findings: FindingForGrouping[],
  now: Date = new Date(),
  recommendations: RecommendationForGrouping[] = [],
): OpportunityGroup[] {
  const actionsByType = new Map<string, ActionForGrouping[]>();
  for (const action of actions) {
    const list = actionsByType.get(action.actionType) ?? [];
    list.push(action);
    actionsByType.set(action.actionType, list);
  }

  // Growth Orchestrator: deterministic cross-agent duplicate consolidation, run before the
  // per-ruleId grouping below so a consolidated pair never also shows up as two separate rows.
  const { consolidated, remaining } = consolidateFindings(findings);

  const actionedPagesByType = new Map<string, Set<string>>();
  for (const action of actions) {
    const set = actionedPagesByType.get(action.actionType) ?? new Set<string>();
    set.add(action.pageUrl);
    actionedPagesByType.set(action.actionType, set);
  }

  const findingsByRule = new Map<string, FindingForGrouping[]>();
  for (const finding of remaining) {
    const mappedActionType = RULE_ID_TO_ACTION_TYPE[finding.ruleId];
    if (mappedActionType && actionedPagesByType.get(mappedActionType)?.has(finding.pageUrl)) continue;
    const list = findingsByRule.get(finding.ruleId) ?? [];
    list.push(finding);
    findingsByRule.set(finding.ruleId, list);
  }

  const groups: OpportunityGroup[] = [];

  for (const opportunity of consolidated) {
    // Same supersession the plain finding-by-rule loop below applies, extended to a consolidated
    // pair: missing_structured_data + missing_entity_markup only consolidate when BOTH fire on
    // the exact same page (see agent-orchestrator.ts) -- if both now have a real Action too
    // (structured_data_fix and entity_markup_fix), this page is no longer an unactioned "found"
    // opportunity. A page where only one of the two has an Action stays visible; nothing here is
    // hidden just because part of it was addressed.
    const openPages = opportunity.pages.filter((p) =>
      p.contributors.some((c) => {
        const mappedActionType = RULE_ID_TO_ACTION_TYPE[c.ruleId];
        return !mappedActionType || !actionedPagesByType.get(mappedActionType)?.has(p.pageUrl);
      })
    );
    if (openPages.length === 0) continue;

    const allContributors = openPages.flatMap((p) => p.contributors);
    groups.push({
      key: `consolidated:${opportunity.ruleId}`,
      issueLabel: opportunity.label,
      pageCount: openPages.length,
      status: 'found',
      proofLayer: null,
      samplePageUrl: openPages[0].pageUrl,
      severity: worstSeverity(openPages.map((p) => ({ pageUrl: p.pageUrl, ruleId: opportunity.ruleId, severity: p.severity }))),
      contributors: allContributors
        .slice(0, MAX_CONTRIBUTORS_SHOWN)
        .map((c) => ({ id: c.id, agent: c.agent, ruleId: c.ruleId, pageUrl: c.pageUrl, evidence: c.evidence, suggestedAction: c.suggestedAction, limitations: c.limitations })),
      consolidationReason: opportunity.reason,
      decisionRecord: buildDecisionRecord({ ...opportunity, pages: openPages }, now),
    });
  }

  for (const [actionType, group] of actionsByType) {
    const { status, proofLayer } = actionGroupStatus(group);
    groups.push({
      key: `action:${actionType}`,
      issueLabel: actionTypePlainSummary(actionType),
      technicalLabel: actionTypeLabel(actionType),
      pageCount: new Set(group.map((a) => a.pageUrl)).size,
      status,
      proofLayer,
      samplePageUrl: group[0].pageUrl,
      severity: null,
    });
  }

  for (const [ruleId, group] of findingsByRule) {
    groups.push({
      key: `finding:${ruleId}`,
      issueLabel: FINDING_PLAIN_LABEL[ruleId] ?? RULE_ISSUE_LABEL[ruleId] ?? ruleId,
      ...(FINDING_PLAIN_LABEL[ruleId] ? { technicalLabel: RULE_ISSUE_LABEL[ruleId] } : {}),
      pageCount: new Set(group.map((f) => f.pageUrl)).size,
      status: 'found',
      proofLayer: null,
      samplePageUrl: group[0].pageUrl,
      severity: worstSeverity(group),
      contributors: group
        .slice(0, MAX_CONTRIBUTORS_SHOWN)
        .map((f) => ({ id: f.id, agent: f.agent, ruleId: f.ruleId, pageUrl: f.pageUrl, evidence: f.evidence, suggestedAction: f.suggestedAction, limitations: f.limitations })),
      ...(NO_AUTOFIX_REASON[ruleId] ? { noAutoFixReason: NO_AUTOFIX_REASON[ruleId] } : {}),
    });
  }

  for (const recommendation of recommendations) {
    groups.push({
      key: `recommendation:${recommendation.id}`,
      issueLabel: recommendation.topic,
      pageCount: 1,
      status: 'found',
      proofLayer: null,
      samplePageUrl: recommendation.pageUrl ?? '',
      severity: null,
      recommendation: {
        id: recommendation.id,
        confidenceLabel: recommendation.confidenceLabel,
        whyNow: recommendation.whyNow ?? '',
        businessRelevance: recommendation.businessRelevance ?? '',
        angle: recommendation.angle ?? '',
      },
    });
  }

  // Descending by page count, then ascending by the group's own stable `key` as a tie-break —
  // Phase 2F S3: equal-count groups must sort the same way regardless of input/iteration order.
  return groups.sort((a, b) => b.pageCount - a.pageCount || a.key.localeCompare(b.key));
}
