import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';
import { normalizeSiteUrl } from '@/lib/entitlements';

vi.mock('@/lib/db', () => ({
  db: { website: { update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
  PENDING_WEBSITE_URL: 'https://example-pending-setup.com',
}));

vi.mock('@/lib/entitlements', () => ({
  normalizeSiteUrl: vi.fn((url: string) => new URL(url).hostname),
}));

function makeRequest(url: string): NextRequest {
  const form = new URLSearchParams({ url });
  return new Request('http://localhost:3000/api/websites/w1/confirm-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as unknown as NextRequest;
}

describe('POST /api/websites/[id]/confirm-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'w1' } });

    expect(res.status).toBe(401);
  });

  it('returns 400 when url is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await POST(makeRequest(''), { params: { id: 'w1' } });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the website does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'someone-elses' } });

    expect(res.status).toBe(404);
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the url is already confirmed', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      website: { id: 'w1', url: 'https://already-real.com' },
    });

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('already confirmed');
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the submitted url is just the pending-setup placeholder', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      website: { id: 'w1', url: PENDING_WEBSITE_URL },
    });

    const res = await POST(makeRequest(PENDING_WEBSITE_URL), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('placeholder');
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it("confirms the url and redirects to that site's dashboard, where the audit starts", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      website: { id: 'w1', url: PENDING_WEBSITE_URL },
    });

    const res = await POST(makeRequest('https://real-site.com'), { params: { id: 'w1' } });

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard/w1');
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { url: 'https://real-site.com', normalizedHost: 'real-site.com' },
    });
  });
});
