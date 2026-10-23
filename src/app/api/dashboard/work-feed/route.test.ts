import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { GET } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { scanJob: { findMany: vi.fn() } } }));
vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockResolve = resolveWebsiteForRequest as ReturnType<typeof vi.fn>;
const mockFindMany = db.scanJob.findMany as ReturnType<typeof vi.fn>;

function makeRequest(websiteId?: string) {
  const url = new URL('http://localhost:3000/api/dashboard/work-feed');
  if (websiteId) url.searchParams.set('websiteId', websiteId);
  return new NextRequest(url);
}

function scan(status: string, startedAt: Date | null = null) {
  return {
    id: `scan_${status}`,
    customerId: 'customer_1',
    websiteId: 'resolved_site',
    status,
    cancelRequested: false,
    createdAt: new Date('2026-10-04T01:00:00.000Z'),
    startedAt,
    completedAt: null,
    resultSummary: null,
    error: null,
    findings: [],
  };
}

describe('GET /api/dashboard/work-feed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockReturnValue({ userId: 'user_1' });
    mockResolve.mockResolvedValue({ website: { id: 'resolved_site' } });
    mockFindMany.mockResolvedValue([]);
  });

  it('returns 401 before resolving or querying when unauthenticated', async () => {
    mockAuth.mockReturnValue({ userId: null });

    const response = await GET(makeRequest('requested_site'));

    expect(response.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns 400 without resolving or querying when websiteId is missing', async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('returns 404 without querying when the website is not owned', async () => {
    mockResolve.mockRejectedValue(new WebsiteNotFoundError('not owned'));

    const response = await GET(makeRequest('foreign_site'));

    expect(response.status).toBe(404);
    expect(mockResolve).toHaveBeenCalledWith('user_1', 'foreign_site');
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('queries the ten newest scans for the resolved website and returns only feed fields', async () => {
    const findings = [{ id: 'finding_1', ruleId: 'missing_canonical', severity: 'high' }];
    mockFindMany.mockResolvedValue([{ ...scan('queued'), findings }]);

    const response = await GET(makeRequest('requested_site'));

    expect(response.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith('user_1', 'requested_site');
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { websiteId: 'resolved_site' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { findings: { select: { id: true, ruleId: true, severity: true } } },
    });
    expect(await response.json()).toEqual([{
      scanId: 'scan_queued',
      timestamp: '2026-10-04T01:00:00.000Z',
      status: 'queued',
      findingCount: 1,
      findings,
    }]);
  });

  it('uses startedAt when available and preserves every known status', async () => {
    const startedAt = new Date('2026-10-04T01:01:00.000Z');
    mockFindMany.mockResolvedValue([
      scan('queued'),
      scan('running', startedAt),
      scan('completed', startedAt),
      scan('failed', startedAt),
      scan('cancelled', startedAt),
    ]);

    const response = await GET(makeRequest('requested_site'));

    expect(await response.json()).toEqual([
      { scanId: 'scan_queued', timestamp: '2026-10-04T01:00:00.000Z', status: 'queued', findingCount: 0, findings: [] },
      { scanId: 'scan_running', timestamp: '2026-10-04T01:01:00.000Z', status: 'running', findingCount: 0, findings: [] },
      { scanId: 'scan_completed', timestamp: '2026-10-04T01:01:00.000Z', status: 'completed', findingCount: 0, findings: [] },
      { scanId: 'scan_failed', timestamp: '2026-10-04T01:01:00.000Z', status: 'failed', findingCount: 0, findings: [] },
      { scanId: 'scan_cancelled', timestamp: '2026-10-04T01:01:00.000Z', status: 'cancelled', findingCount: 0, findings: [] },
    ]);
  });

  it('normalizes an unfamiliar status to unknown', async () => {
    mockFindMany.mockResolvedValue([scan('future_status')]);

    const response = await GET(makeRequest('requested_site'));

    expect(await response.json()).toEqual([{
      scanId: 'scan_future_status',
      timestamp: '2026-10-04T01:00:00.000Z',
      status: 'unknown',
      findingCount: 0,
      findings: [],
    }]);
  });

  it('returns an empty feed when the website has no scans', async () => {
    const response = await GET(makeRequest('requested_site'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('propagates unexpected resolver failures without querying', async () => {
    mockResolve.mockRejectedValue(new Error('resolver unavailable'));

    await expect(GET(makeRequest('requested_site'))).rejects.toThrow('resolver unavailable');
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
