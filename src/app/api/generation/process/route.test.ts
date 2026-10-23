import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { claimAndRunGenerationJob, reapStaleGenerationJobs } from '@/lib/generation-worker';

vi.mock('@/lib/db', () => ({
  db: {
    generationJob: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/generation-worker', () => ({
  claimAndRunGenerationJob: vi.fn(),
  reapStaleGenerationJobs: vi.fn(),
}));

const mockVerify = vi.fn();
vi.mock('@upstash/qstash', () => ({
  Receiver: vi.fn().mockImplementation(() => ({ verify: mockVerify })),
}));

function makeRequest(headerOverrides: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost:3000/api/generation/process', { headers: headerOverrides }) as unknown as NextRequest;
}

describe('GET /api/generation/process', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    (reapStaleGenerationJobs as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  it('returns 401 when the bearer token is missing or wrong', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong-secret' }));

    expect(res.status).toBe(401);
    expect(db.generationJob.findFirst).not.toHaveBeenCalled();
  });

  it('reaps stale running jobs before dequeuing', async () => {
    (db.generationJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await GET(makeRequest({ authorization: 'Bearer test-secret' }));

    expect(reapStaleGenerationJobs).toHaveBeenCalledTimes(1);
  });

  it('returns processed:false when no eligible job exists', async () => {
    (db.generationJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ processed: false });
    expect(claimAndRunGenerationJob).not.toHaveBeenCalled();
  });

  it('only considers jobs whose nextRetryAt has passed (or is unset)', async () => {
    (db.generationJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await GET(makeRequest({ authorization: 'Bearer test-secret' }));

    expect(db.generationJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['queued', 'waiting_retry', 'rate_limited', 'blocked'] },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: expect.any(Date) } }],
        }),
      })
    );
  });

  it('claims and runs the oldest eligible job, returning its outcome', async () => {
    (db.generationJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_1' });
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true, outcome: 'completed' });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ processed: true, jobId: 'job_1', outcome: 'completed' });
    expect(claimAndRunGenerationJob).toHaveBeenCalledWith('job_1');
  });

  it('returns 500 when the claimed job ends in a permanent failure', async () => {
    (db.generationJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_1' });
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true, outcome: 'failed' });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ processed: true, jobId: 'job_1', outcome: 'failed' });
  });

  it('bails out without a processed result when another invocation already claimed the job', async () => {
    (db.generationJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_1' });
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: false });

    const res = await GET(makeRequest({ authorization: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ processed: false });
  });

  it('accepts a request with no valid cron secret but a verified QStash signature', async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-key';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next-key';
    mockVerify.mockResolvedValue(true);
    (db.generationJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

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
    expect(db.generationJob.findFirst).not.toHaveBeenCalled();
  });
});
