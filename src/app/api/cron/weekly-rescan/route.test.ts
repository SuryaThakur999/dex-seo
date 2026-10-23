import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { enqueueScanIfNeeded } from '@/lib/scan-trigger';

vi.mock('@/lib/db', () => ({
  db: { website: { findMany: vi.fn() } },
}));
vi.mock('@/lib/scan-trigger', () => ({
  enqueueScanIfNeeded: vi.fn(),
}));

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request('http://localhost:3000/api/cron/weekly-rescan', { headers }) as unknown as NextRequest;
}

describe('GET /api/cron/weekly-rescan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-secret');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('rejects a call with no authorization header', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(db.website.findMany).not.toHaveBeenCalled();
  });

  it('rejects a call with the wrong bearer token', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('rejects every call when CRON_SECRET is not configured, even with a matching-looking header', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(makeRequest('Bearer '));
    expect(res.status).toBe(401);
  });

  it('only queries confirmed (non-pending-URL) websites', async () => {
    (db.website.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(makeRequest('Bearer test-secret'));
    expect(db.website.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ url: expect.objectContaining({ not: expect.anything() }) }),
    }));
  });

  it('enqueues a scan for every confirmed website and counts how many were newly enqueued vs already queued/running', async () => {
    (db.website.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'w1', clientProfile: { customerId: 'c1' } }, { id: 'w2', clientProfile: { customerId: 'c2' } },
    ]);
    (enqueueScanIfNeeded as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ enqueued: true, jobId: 'job_1' })
      .mockResolvedValueOnce({ enqueued: false, jobId: 'job_existing' });

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(enqueueScanIfNeeded).toHaveBeenCalledWith('c1', expect.objectContaining({ id: 'w1' }));
    expect(enqueueScanIfNeeded).toHaveBeenCalledWith('c2', expect.objectContaining({ id: 'w2' }));
    expect(body).toEqual({ processed: 2, enqueued: 1, alreadyQueued: 1, failed: 0 });
  });

  it('counts one website failing to enqueue without stopping the rest', async () => {
    (db.website.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'w1', clientProfile: { customerId: 'c1' } }, { id: 'w2', clientProfile: { customerId: 'c2' } },
    ]);
    (enqueueScanIfNeeded as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ enqueued: true, jobId: 'job_2' });

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(body).toEqual({ processed: 2, enqueued: 1, alreadyQueued: 0, failed: 1 });
  });
});
