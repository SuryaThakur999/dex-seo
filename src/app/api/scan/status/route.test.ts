import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

vi.mock('@/lib/db', () => ({
  db: {
    scanJob: { findMany: vi.fn() },
    scanLogLine: { findMany: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

function makeRequest(websiteId?: string): NextRequest {
  const url = websiteId
    ? `http://localhost:3000/api/scan/status?websiteId=${websiteId}`
    : 'http://localhost:3000/api/scan/status';
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

describe('GET /api/scan/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
  });

  it('returns 404 when the website is not found or not owned by this user', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await GET(makeRequest('other-site'));

    expect(res.status).toBe(404);
  });

  it("scopes jobs to the resolved website, newest first, capped at 5", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'site_1' } });
    const jobs = [
      { id: 'job_2', status: 'running', createdAt: new Date('2026-01-02'), completedAt: null, error: null, resultSummary: null },
    ];
    (db.scanJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(jobs);

    const res = await GET(makeRequest('site_1'));
    const body = await res.json();

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'site_1');
    expect(db.scanJob.findMany).toHaveBeenCalledWith({
      where: { websiteId: 'site_1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, status: true, createdAt: true, completedAt: true, error: true, resultSummary: true },
    });
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].id).toBe('job_2');
    expect(body.jobs[0].createdAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('resolves the default website when no websiteId is given', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'site_1' } });
    (db.scanJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await GET(makeRequest());

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', undefined);
  });

  it("includes the newest job's log lines, oldest first, capped at 20", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'site_1' } });
    const jobs = [
      { id: 'job_2', status: 'running', createdAt: new Date('2026-01-02'), completedAt: null, error: null, resultSummary: null },
    ];
    (db.scanJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(jobs);
    const lines = [{ id: 'line_1', message: 'Found 3 pages to check.', createdAt: new Date('2026-01-02T00:00:01Z') }];
    (db.scanLogLine.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(lines);

    const res = await GET(makeRequest('site_1'));
    const body = await res.json();

    expect(db.scanLogLine.findMany).toHaveBeenCalledWith({
      where: { scanJobId: 'job_2' },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, message: true, createdAt: true },
    });
    expect(body.logLines).toHaveLength(1);
    expect(body.logLines[0].message).toBe('Found 3 pages to check.');
  });

  it('returns an empty logLines array when there are no jobs', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'site_1' } });
    (db.scanJob.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await GET(makeRequest('site_1'));
    const body = await res.json();

    expect(db.scanLogLine.findMany).not.toHaveBeenCalled();
    expect(body.logLines).toEqual([]);
  });
});
