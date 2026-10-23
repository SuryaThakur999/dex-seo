import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { runScanForCustomer } from '@/lib/run-scan';

vi.mock('@/lib/db', () => ({
  db: {
    scanJob: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    scanLogLine: { create: vi.fn() },
  },
}));

vi.mock('@/lib/run-scan', () => ({
  runScanForCustomer: vi.fn(),
}));

const mockVerify = vi.fn();
vi.mock('@upstash/qstash', () => ({
  Receiver: vi.fn().mockImplementation(() => ({ verify: mockVerify })),
}));

function makeRequest(headerOverrides: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost:3000/api/scan/process', { headers: headerOverrides }) as unknown as NextRequest;
}

describe('GET /api/scan/process', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  it('returns 401 when the bearer token is missing or wrong', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong-secret' }));

    expect(res.status).toBe(401);
    expect(db.scanJob.findFirst).not.toHaveBeenCalled();
  });

  it('returns 401 when CRON_SECRET is unset, even if the header literally says "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(makeRequest({ authorization: 'Bearer undefined' }));

    expect(res.status).toBe(401);
    expect(db.scanJob.findFirst).not.toHaveBeenCalled();
  });

  it('accepts a request with no valid cron secret but a verified QStash signature', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-key';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next-key';
    mockVerify.mockResolvedValue(true);
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET(makeRequest({ 'upstash-signature': 'valid-sig' }));

    expect(res.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith({ signature: 'valid-sig', body: '' });
  });

  it('rejects a request with an unverified QStash signature', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-key';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next-key';
    mockVerify.mockResolvedValue(false);

    const res = await GET(makeRequest({ 'upstash-signature': 'bad-sig' }));

    expect(res.status).toBe(401);
    expect(db.scanJob.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a QStash signature header when signing keys are not configured', async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;

    const res = await GET(makeRequest({ 'upstash-signature': 'some-sig' }));

    expect(res.status).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('treats a verification exception as a rejection, not a server error', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-key';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next-key';
    mockVerify.mockRejectedValue(new Error('signature expired'));

    const res = await GET(makeRequest({ 'upstash-signature': 'expired-sig' }));

    expect(res.status).toBe(401);
    expect(db.scanJob.findFirst).not.toHaveBeenCalled();
  });

  it('returns processed:false when no queued job exists', async () => {
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ processed: false });
  });

  it('runs the scan for the oldest queued job and marks it completed', async () => {
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'job_1',
      customer: { id: 'cust_1' },
      website: { id: 'web_1', url: 'https://example.com' },
    });
    (db.scanJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (runScanForCustomer as ReturnType<typeof vi.fn>).mockResolvedValue({
      pagesScanned: 3,
      pagesFlagged: 1,
      draftsCreated: 1,
      errors: [],
    });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ processed: true, jobId: 'job_1' });
    expect(db.scanJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job_1' }, data: expect.objectContaining({ status: 'completed' }) })
    );
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_1', message: 'Starting scan for https://example.com...' },
    });
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_1', message: 'Scan complete — 3 pages checked, 1 draft created.' },
    });
    expect(runScanForCustomer).toHaveBeenCalledWith(
      { id: 'cust_1' },
      { id: 'web_1', url: 'https://example.com' },
      'job_1'
    );
  });

  it('bails out without running the scan when another invocation already claimed the job', async () => {
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'job_1',
      customer: { id: 'cust_1' },
    });
    (db.scanJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ processed: false });
    expect(runScanForCustomer).not.toHaveBeenCalled();
  });

  it('reaps stale running jobs before dequeuing, without touching queued/completed/failed jobs', async () => {
    (db.scanJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await GET(makeRequest({ authorization: 'Bearer test-secret' }));

    const [reapCall] = (db.scanJob.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(reapCall[0]).toEqual(
      expect.objectContaining({
        where: { status: 'running', startedAt: { lt: expect.any(Date) } },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('marks the job failed when runScanForCustomer throws', async () => {
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'job_1',
      customer: { id: 'cust_1' },
      website: { id: 'web_1', url: 'https://example.com' },
    });
    (db.scanJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (runScanForCustomer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('GSC token revoked'));

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ processed: true, jobId: 'job_1', failed: true });
    expect(db.scanJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job_1' },
        data: expect.objectContaining({ status: 'failed', error: 'GSC token revoked' }),
      })
    );
    expect(db.scanLogLine.create).toHaveBeenCalledWith({
      data: { scanJobId: 'job_1', message: 'Scan failed: GSC token revoked' },
    });
  });
});
