import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { GET } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { scanJob: { count: vi.fn() }, action: { count: vi.fn() } } }));
vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockResolve = resolveWebsiteForRequest as ReturnType<typeof vi.fn>;
const mockScanCount = db.scanJob.count as ReturnType<typeof vi.fn>;
const mockActionCount = db.action.count as ReturnType<typeof vi.fn>;

function makeRequest(websiteId?: string) {
  const url = new URL('http://localhost:3000/api/dashboard/daily-mission');
  if (websiteId) url.searchParams.set('websiteId', websiteId);
  return new NextRequest(url);
}

describe('GET /api/dashboard/daily-mission', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockReturnValue({ userId: 'user_1' });
    mockResolve.mockResolvedValue({ website: { id: 'resolved_site' } });
    mockScanCount.mockResolvedValue(0);
    mockActionCount.mockResolvedValue(0);
  });

  it('returns 401 before resolving or counting when unauthenticated', async () => {
    mockAuth.mockReturnValue({ userId: null });

    const response = await GET(makeRequest('requested_site'));

    expect(response.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockScanCount).not.toHaveBeenCalled();
    expect(mockActionCount).not.toHaveBeenCalled();
  });

  it('returns 400 without resolving or counting when websiteId is missing', async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockScanCount).not.toHaveBeenCalled();
    expect(mockActionCount).not.toHaveBeenCalled();
  });

  it('returns 404 without counts for a foreign website', async () => {
    mockResolve.mockRejectedValue(new WebsiteNotFoundError('not owned'));

    const response = await GET(makeRequest('foreign_site'));

    expect(response.status).toBe(404);
    expect(mockResolve).toHaveBeenCalledWith('user_1', 'foreign_site');
    expect(mockScanCount).not.toHaveBeenCalled();
    expect(mockActionCount).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'prioritizes active scans over pending actions', activeScans: 1, pendingActions: 4,
      mission: { icon: '🔍', title: 'Audit in Progress', description: 'Follow the latest scan as it runs.', cta: 'Watch Feed', ctaHref: '#work-feed' },
    },
    {
      name: 'uses the pending action count when there are no active scans', activeScans: 0, pendingActions: 2,
      mission: { icon: '📋', title: 'Review 2 changes', description: 'Draft changes are waiting for your decision.', cta: 'Open Review Queue', ctaHref: '/review' },
    },
    {
      name: 'offers a new scan when both counts are zero', activeScans: 0, pendingActions: 0,
      mission: { icon: '🚀', title: 'Start a New Audit', description: 'Run an audit to find the next opportunity.', cta: 'New Scan', ctaHref: '#scan-control' },
    },
  ])('$name', async ({ activeScans, pendingActions, mission }) => {
    mockScanCount.mockResolvedValue(activeScans);
    mockActionCount.mockResolvedValue(pendingActions);

    const response = await GET(makeRequest('requested_site'));

    expect(response.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith('user_1', 'requested_site');
    expect(mockScanCount).toHaveBeenCalledWith({
      where: { websiteId: 'resolved_site', status: { in: ['queued', 'running'] } },
    });
    expect(mockActionCount).toHaveBeenCalledWith({
      where: { websiteId: 'resolved_site', status: 'pending' },
    });
    expect(await response.json()).toEqual(mission);
  });

  it('propagates unexpected resolver failures without counts', async () => {
    mockResolve.mockRejectedValue(new Error('resolver unavailable'));

    await expect(GET(makeRequest('requested_site'))).rejects.toThrow('resolver unavailable');
    expect(mockScanCount).not.toHaveBeenCalled();
    expect(mockActionCount).not.toHaveBeenCalled();
  });
});
