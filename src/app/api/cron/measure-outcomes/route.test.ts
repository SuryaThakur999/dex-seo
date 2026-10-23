import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { getPagePerformanceForRange } from '@/lib/gsc-client';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findMany: vi.fn(), updateMany: vi.fn() },
    website: { updateMany: vi.fn() },
    auditLogEntry: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((token: string) => `decrypted-${token}`),
}));

vi.mock('@/lib/gsc-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gsc-client')>();
  return { ...actual, getPagePerformanceForRange: vi.fn() };
});

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request('http://localhost:3000/api/cron/measure-outcomes', { headers }) as unknown as NextRequest;
}

describe('GET /api/cron/measure-outcomes', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it('returns 401 when the bearer token is missing or wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(db.action.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(makeRequest('Bearer undefined'));

    expect(res.status).toBe(401);
  });

  it('returns zeroed counts when there are no candidate actions', async () => {
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(body).toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 0, unavailable: 0 });
  });

  it('excludes websites with GSC connected but no resolved property from the candidate query', async () => {
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await GET(makeRequest('Bearer test-secret'));

    const queryArgs = (db.action.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(queryArgs.where.website).toEqual(
      expect.objectContaining({ gscPropertyUrl: { not: null } })
    );
  });

  it('measures and stores the outcome for a candidate action', async () => {
    const baselineCapturedAt = new Date('2026-01-01T00:00:00Z');
    const action = makeCandidate('action_1', 'https://example.com/a', baselineCapturedAt);
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([action]);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([action.event]);
    (getPagePerformanceForRange as ReturnType<typeof vi.fn>).mockResolvedValue([
      { url: 'https://example.com/a', impressions: 150, clicks: 9, ctr: 0.06 },
    ]);
    (db.action.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(getPagePerformanceForRange).toHaveBeenCalledWith(
      'decrypted-encrypted-token',
      'https://example.com',
      '2026-01-02',
      '2026-01-30'
    );
    const updateArgs = (db.action.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArgs.where).toEqual(expect.objectContaining({ id: 'action_1', customerId: 'cust_1', websiteId: 'web_1', status: 'approved', decidedAt: action.decidedAt, baselineCapturedAt, outcomeMeasuredAt: null }));
    expect(updateArgs.data.outcomePerformance).toEqual({ impressions: 150, clicks: 9, ctr: 0.06, captureVersion: 1, availability: 'observed_gsc_row', decisionEventId: 'event_action_1' });
    expect(updateArgs.data.outcomeMeasuredAt).toBeInstanceOf(Date);
    expect(body).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0, unavailable: 0 });
  });

  it('continues past a failing candidate instead of aborting the run', async () => {
    const failed = makeCandidate('action_fail', 'https://example.com/a', new Date('2026-01-01T00:00:00Z'));
    const succeeded = makeCandidate('action_ok', 'https://example.com/b', new Date('2026-01-01T00:00:00Z'));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([failed, succeeded]);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([failed.event]).mockResolvedValueOnce([succeeded.event]);
    (db.action.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (getPagePerformanceForRange as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('token revoked'))
      .mockResolvedValueOnce([{ url: 'https://example.com/b', impressions: 20, clicks: 1, ctr: 0.05 }]);

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(db.action.updateMany).toHaveBeenCalledTimes(1);
    expect((db.action.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where.id).toEqual('action_ok');
    expect(body).toEqual({ processed: 2, succeeded: 1, failed: 1, skipped: 0, unavailable: 1 });
  });

  it('leaves the outcome unset when GSC returns no observed page row', async () => {
    const action = makeCandidate('action_empty', 'https://example.com/empty', new Date('2026-01-01T00:00:00Z'));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([action]);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([action.event]);
    (getPagePerformanceForRange as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(db.action.updateMany).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ processed: 1, succeeded: 0, failed: 0, skipped: 1, unavailable: 1 });
  });

  it('discards a measurement when the decision or baseline changes during the GSC call', async () => {
    const action = makeCandidate('action_stale', 'https://example.com/stale', new Date('2026-01-01T00:00:00Z'));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([action]);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([action.event]);
    (getPagePerformanceForRange as ReturnType<typeof vi.fn>).mockResolvedValue([
      { url: action.pageUrl, impressions: 150, clicks: 9, ctr: 0.06 },
    ]);
    (db.action.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(await response.json()).toEqual({ processed: 1, succeeded: 0, failed: 0, skipped: 1, unavailable: 0 });
  });
});

function makeCandidate(id: string, pageUrl: string, baselineCapturedAt: Date) {
  const decidedAt = new Date('2025-12-31T00:00:00.000Z');
  const event = {
    id: `event_${id}`,
    customerId: 'cust_1',
    actionId: id,
    eventType: 'action_decided',
    createdAt: decidedAt,
    detail: {
      decision: 'approved',
      pageUrl,
      actorClerkUserId: 'clerk_1',
      receiptSnapshot: {
        version: 1,
        actionId: id,
        customerId: 'cust_1',
        clientProfileId: 'profile_1',
        websiteId: 'web_1',
        pageUrl,
        actionType: 'meta_description',
        currentValue: 'Before',
        preDecisionDraftContent: 'Draft',
        decidedContent: 'Draft',
        decision: 'approved',
        actorClerkUserId: 'clerk_1',
        decidedAt: decidedAt.toISOString(),
        riskTier: 'low',
        policyVersion: 'v1',
        guard: { outcome: 'pass', reasoning: 'ok', checksRun: [{ check: 'required', result: 'pass', detail: 'ok' }] },
        checkedContent: 'unavailable',
        provenance: { status: 'unavailable' },
      },
    },
  };
  return {
    id,
    customerId: 'cust_1',
    websiteId: 'web_1',
    pageUrl,
    actionType: 'meta_description',
    currentValue: 'Before',
    draftContent: 'Draft',
    status: 'approved',
    decidedAt,
    riskTier: 'low',
    policyVersion: 'v1',
    guardResult: { outcome: 'pass', reasoning: 'ok', checksRun: [{ check: 'required', result: 'pass', detail: 'ok' }] },
    baselineCapturedAt,
    baselinePerformance: { impressions: 10, clicks: 2, ctr: 0.2, captureVersion: 1, availability: 'observed_gsc_row', decisionEventId: event.id },
    website: { id: 'web_1', clientProfileId: 'profile_1', clientProfile: { id: 'profile_1', customerId: 'cust_1' }, gscRefreshToken: 'encrypted-token', url: 'https://example.com', gscPropertyUrl: 'https://example.com' },
    event,
  };
}
