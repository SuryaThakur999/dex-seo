import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { runCompetitorWatch } from '@/lib/research/competitor-watch-job';

vi.mock('@/lib/db', () => ({
  db: { clientProfile: { findMany: vi.fn() } },
}));
vi.mock('@/lib/research/competitor-watch-job', () => ({
  runCompetitorWatch: vi.fn(),
}));

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return new Request('http://localhost:3000/api/cron/competitor-watch', { headers }) as unknown as NextRequest;
}

describe('GET /api/cron/competitor-watch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-secret');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('rejects a call with no authorization header', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(db.clientProfile.findMany).not.toHaveBeenCalled();
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

  it('runs competitor watch for every active (website-having) client profile and sums changes', async () => {
    (db.clientProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'profile_1' }, { id: 'profile_2' }]);
    (runCompetitorWatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ changed: [{ id: 'e1' }, { id: 'e2' }] })
      .mockResolvedValueOnce({ changed: [] });

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(db.clientProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { websites: { some: {} } } }));
    expect(runCompetitorWatch).toHaveBeenCalledWith('profile_1');
    expect(runCompetitorWatch).toHaveBeenCalledWith('profile_2');
    expect(body).toEqual({ processed: 2, changed: 2, failed: 0 });
  });

  it('counts one profile failing without stopping the rest', async () => {
    (db.clientProfile.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'profile_1' }, { id: 'profile_2' }]);
    (runCompetitorWatch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ changed: [{ id: 'e1' }] });

    const res = await GET(makeRequest('Bearer test-secret'));
    const body = await res.json();

    expect(body).toEqual({ processed: 2, changed: 1, failed: 1 });
  });
});
