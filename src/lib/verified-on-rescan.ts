// Verified on next scan (docs/superpowers/specs/2026-10-17-verified-on-rescan-design.md).
// Matches an earlier scan's open Finding rows against what the newest scan actually observed
// on the same page, and records fixed/excluded/could_not_verify -- an observation, never a
// human decision, so ActionStatus is never touched here.
import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export function normalizePageUrlForRescan(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    } else if (parsed.pathname === '') {
      parsed.pathname = '/';
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

export type RescanResolution = 'fixed' | 'excluded' | 'could_not_verify';

export function resolveFindingOutcome(input: {
  ruleStillFires: boolean;
  httpStatus: number | null;
  blockedByRobots: boolean;
  noindex: boolean;
}): RescanResolution | null {
  if (input.blockedByRobots || input.noindex) return 'excluded';
  if (input.httpStatus === null || input.httpStatus >= 400) return 'could_not_verify';
  if (!input.ruleStillFires) return 'fixed';
  return null;
}

export interface VerifiedFixesRow {
  pageUrl: string;
  firstFoundAt: string;
  resolvedAt: string;
  resolution: 'fixed' | 'excluded';
  proofLine: string;
}

export interface VerifiedFixesRuleGroup {
  ruleId: string;
  rows: VerifiedFixesRow[];
  rejectedAsFalsePositiveRate: number | null;
}

export interface VerifiedFixesData {
  last30: { count: number; medianDaysToVerify: number | null };
  last90: { count: number; medianDaysToVerify: number | null };
  byRule: VerifiedFixesRuleGroup[];
}

interface VerifiedFixFindingInput {
  pageUrl: string;
  ruleId: string;
  retrievedAt: Date;
  resolvedAt: Date;
  resolution: 'fixed' | 'excluded';
  evidence: unknown;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
}

function proofLineFor(finding: VerifiedFixFindingInput): string {
  if (finding.resolution === 'excluded') return 'Excluded from index on purpose';
  const evidence = finding.evidence;
  if (evidence && typeof evidence === 'object' && 'note' in evidence && typeof (evidence as { note: unknown }).note === 'string') {
    return (evidence as { note: string }).note;
  }
  return 'Rule no longer fires';
}

function windowSummary(findings: VerifiedFixFindingInput[], now: Date, windowDays: number): { count: number; medianDaysToVerify: number | null } {
  const inWindow = findings.filter((f) => daysBetween(f.resolvedAt, now) <= windowDays);
  return { count: inWindow.length, medianDaysToVerify: medianOf(inWindow.map((f) => daysBetween(f.retrievedAt, f.resolvedAt))) };
}

// Pure computation -- the caller (an Outcomes-tab data loader) fetches the resolved Finding
// rows for this website and any rejection counts, both already real DB reads; this function
// does no DB access of its own, matching the computeOutcomesSummary/computeDashboardStats
// convention in dashboard-stats.ts (page.tsx queries, this module computes).
export function computeVerifiedFixes(
  findings: VerifiedFixFindingInput[],
  rejectionCountsByRuleId: Record<string, { rejected: number; total: number }>,
  now: Date = new Date()
): VerifiedFixesData {
  const byRuleId = new Map<string, VerifiedFixFindingInput[]>();
  for (const finding of findings) {
    const group = byRuleId.get(finding.ruleId) ?? [];
    group.push(finding);
    byRuleId.set(finding.ruleId, group);
  }

  const byRule: VerifiedFixesRuleGroup[] = Array.from(byRuleId.entries()).map(([ruleId, rows]) => {
    const counts = rejectionCountsByRuleId[ruleId];
    return {
      ruleId,
      rows: rows.map((f) => ({
        pageUrl: f.pageUrl,
        firstFoundAt: f.retrievedAt.toISOString(),
        resolvedAt: f.resolvedAt.toISOString(),
        resolution: f.resolution,
        proofLine: proofLineFor(f),
      })),
      rejectedAsFalsePositiveRate: counts && counts.total > 0 ? counts.rejected / counts.total : null,
    };
  });

  return {
    last30: windowSummary(findings, now, 30),
    last90: windowSummary(findings, now, 90),
    byRule,
  };
}

// The OR: [{resolution: null}, {resolution: 'could_not_verify'}] clause below is "not yet
// terminally resolved" -- once a finding is 'fixed' or 'excluded' it drops out of this query
// permanently, which is what makes repeated calls idempotent and what keeps a later "came back"
// finding from retroactively unresolving the old record. (Prisma's `in` filter on a nullable
// String field rejects `null` as a member, hence OR instead of resolution: { in: [...] }.)

export async function resolvePriorFindingsForPage(params: {
  websiteId: string;
  customerId: string;
  scanJobId: string;
  pageUrl: string;
  agent: string;
  firedRuleIds: Set<string>;
  httpStatus: number | null;
  blockedByRobots: boolean;
  noindex: boolean;
  evidenceForFixed: (ruleId: string) => unknown;
}): Promise<{ resolvedCount: number }> {
  const normalized = normalizePageUrlForRescan(params.pageUrl);
  const priorFindings = await db.finding.findMany({
    where: {
      websiteId: params.websiteId,
      agent: params.agent,
      OR: [{ resolution: null }, { resolution: 'could_not_verify' }],
      scanJobId: { not: params.scanJobId },
    },
  });
  const onThisPage = priorFindings.filter((f) => normalizePageUrlForRescan(f.pageUrl) === normalized);

  let resolvedCount = 0;
  for (const finding of onThisPage) {
    const outcome = resolveFindingOutcome({
      ruleStillFires: params.firedRuleIds.has(finding.ruleId),
      httpStatus: params.httpStatus,
      blockedByRobots: params.blockedByRobots,
      noindex: params.noindex,
    });
    if (outcome === null) continue; // still found, nothing to write

    if (outcome === 'could_not_verify') {
      await db.finding.update({ where: { id: finding.id }, data: { resolution: 'could_not_verify' } });
      continue;
    }

    await db.finding.update({
      where: { id: finding.id },
      data: {
        resolution: outcome,
        resolvedAt: new Date(),
        resolvedByScanJobId: params.scanJobId,
        evidence: outcome === 'fixed'
          ? (params.evidenceForFixed(finding.ruleId) as Prisma.InputJsonValue)
          : (finding.evidence as Prisma.InputJsonValue),
      },
    });
    await db.auditLogEntry.create({
      data: {
        customerId: params.customerId,
        eventType: 'finding_resolved_on_rescan',
        detail: { findingId: finding.id, resolution: outcome, scanJobId: params.scanJobId },
      },
    });
    resolvedCount += 1;
  }
  return { resolvedCount };
}

export async function resolveUnvisitedFindings(params: {
  websiteId: string;
  scanJobId: string;
  visitedNormalizedPageUrls: Set<string>;
}): Promise<{ resolvedCount: number }> {
  const openFindings = await db.finding.findMany({
    where: { websiteId: params.websiteId, OR: [{ resolution: null }, { resolution: 'could_not_verify' }], scanJobId: { not: params.scanJobId } },
  });
  let resolvedCount = 0;
  for (const finding of openFindings) {
    if (params.visitedNormalizedPageUrls.has(normalizePageUrlForRescan(finding.pageUrl))) continue;
    await db.finding.update({ where: { id: finding.id }, data: { resolution: 'could_not_verify' } });
    resolvedCount += 1;
  }
  return { resolvedCount };
}
