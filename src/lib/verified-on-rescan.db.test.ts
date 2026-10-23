import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    finding: { findMany: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn() },
  },
}));

import { db } from '@/lib/db';
import { resolvePriorFindingsForPage, resolveUnvisitedFindings } from './verified-on-rescan';

describe('resolvePriorFindingsForPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks a prior open finding fixed and writes one audit entry when the rule no longer fires', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} },
    ]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({ canonical: 'https://example.com/blog' }),
    });
    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'f1' },
      data: expect.objectContaining({ resolution: 'fixed', resolvedByScanJobId: 'scan2' }),
    }));
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(1);
    expect(db.auditLogEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'finding_resolved_on_rescan', customerId: 'c1' }),
    }));
  });

  it('does not touch a finding whose rule still fires (still found, no write)', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} },
    ]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(['missing_canonical']), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(db.finding.update).not.toHaveBeenCalled();
    expect(db.auditLogEntry.create).not.toHaveBeenCalled();
  });

  it('marks excluded (robots-blocked) and writes an audit entry, even though the rule would still fire', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} },
    ]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(['missing_canonical']), httpStatus: 200, blockedByRobots: true, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resolution: 'excluded' }),
    }));
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it('marks could_not_verify without setting resolvedAt and without an audit entry', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} },
    ]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(), httpStatus: 503, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { resolution: 'could_not_verify' },
    }));
    expect(db.auditLogEntry.create).not.toHaveBeenCalled();
  });

  it('only queries findings not already terminally resolved (fixed/excluded excluded from the query)', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(db.finding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ resolution: null }, { resolution: 'could_not_verify' }] }),
    }));
  });

  it('is idempotent: calling twice does not write a second audit entry for the same finding, because the first call already excluded it from the open-findings query', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/blog', evidence: {} }])
      .mockResolvedValueOnce([]);
    const args = {
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set<string>(), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    };
    await resolvePriorFindingsForPage(args);
    await resolvePriorFindingsForPage(args);
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-fixed finding alone when the same rule fires again later (came back) -- the where-clause excludes fixed/excluded from the query, so it never reaches the update branch', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan3', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(['missing_canonical']), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(result.resolvedCount).toBe(0);
    expect(db.finding.update).not.toHaveBeenCalled();
  });

  it('only resolves findings matching the same normalized page URL, not other pages on the same website', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', ruleId: 'missing_canonical', pageUrl: 'https://example.com/other-page', evidence: {} },
    ]);
    const result = await resolvePriorFindingsForPage({
      websiteId: 'w1', customerId: 'c1', scanJobId: 'scan2', pageUrl: 'https://example.com/blog', agent: 'seo_specialist',
      firedRuleIds: new Set(), httpStatus: 200, blockedByRobots: false, noindex: false,
      evidenceForFixed: () => ({}),
    });
    expect(result.resolvedCount).toBe(0);
    expect(db.finding.update).not.toHaveBeenCalled();
  });
});

describe('resolveUnvisitedFindings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks could_not_verify for open findings on pages the scan never visited this run', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f2', pageUrl: 'https://example.com/unreached' },
    ]);
    await resolveUnvisitedFindings({ websiteId: 'w1', scanJobId: 'scan2', visitedNormalizedPageUrls: new Set(['https://example.com/blog']) });
    expect(db.finding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'f2' },
      data: { resolution: 'could_not_verify' },
    }));
  });

  it('leaves a finding alone when its page was visited this scan', async () => {
    (db.finding.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f2', pageUrl: 'https://example.com/blog' },
    ]);
    await resolveUnvisitedFindings({ websiteId: 'w1', scanJobId: 'scan2', visitedNormalizedPageUrls: new Set(['https://example.com/blog']) });
    expect(db.finding.update).not.toHaveBeenCalled();
  });
});
