import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';
import { claimAndRunScanJob } from '@/lib/scan-worker';

vi.mock('@/lib/db', () => ({
  db: {
    scanJob: { findFirst: vi.fn(), create: vi.fn(() => Promise.resolve({ id: 'job_1' })) },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
  PENDING_WEBSITE_URL: 'https://example-pending-setup.com',
}));

vi.mock('@/lib/scan-worker', () => ({
  claimAndRunScanJob: vi.fn(),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/scan', { method: 'POST' }) as unknown as NextRequest;
}

function makeFormRequest(websiteId?: string): NextRequest {
  const form = new URLSearchParams();
  if (websiteId) form.set('websiteId', websiteId);
  return new Request('http://localhost:3000/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as unknown as NextRequest;
}

describe('POST /api/scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(resolveWebsiteForRequest).not.toHaveBeenCalled();
  });

  it('enqueues a scan for a website with no GSC connection at all', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_1', gscRefreshToken: null, url: 'https://acme.com' },
      websites: [],
    });
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(303);
    expect(db.scanJob.create).toHaveBeenCalledWith({ data: { customerId: 'cust_1', websiteId: 'web_1', status: 'queued' } });
    expect(claimAndRunScanJob).toHaveBeenCalledWith({
      id: 'job_1',
      customer: { id: 'cust_1' },
      website: { id: 'web_1', gscRefreshToken: null, url: 'https://acme.com' },
    });
  });

  it('returns 400 without enqueueing when the website is still on the pending-setup sentinel URL', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_1', gscRefreshToken: 'token', url: PENDING_WEBSITE_URL },
      websites: [],
    });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Confirm this website');
    expect(db.scanJob.create).not.toHaveBeenCalled();
  });


  it('enqueues a queued ScanJob and redirects when none is already in flight', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_1', gscRefreshToken: 'token' },
      websites: [],
    });
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(303);
    expect(db.scanJob.create).toHaveBeenCalledWith({ data: { customerId: 'cust_1', websiteId: 'web_1', status: 'queued' } });
  });

  it('does not enqueue a second job while one is already queued or running', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_1', gscRefreshToken: 'token' },
      websites: [],
    });
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_1', status: 'running' });

    const res = await POST(makeRequest());

    expect(res.status).toBe(303);
    expect(db.scanJob.create).not.toHaveBeenCalled();
    expect(claimAndRunScanJob).not.toHaveBeenCalled();
  });

  it('returns 404 when websiteId does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeFormRequest('someone-elses-website'));

    expect(res.status).toBe(404);
    expect(db.scanJob.create).not.toHaveBeenCalled();
  });

  it('redirects to the dashboard for the resolved website, not a bare /dashboard', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_2', gscRefreshToken: 'token' },
      websites: [],
    });
    (db.scanJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeFormRequest('web_2'));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'web_2');
    expect(res.headers.get('location')).toContain('/dashboard/web_2');
  });
});
