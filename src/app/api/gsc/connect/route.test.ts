import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { buildAuthUrl } from '@/lib/google-oauth';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/google-oauth', () => ({ buildAuthUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/mock') }));

function makeRequest(websiteId?: string): NextRequest {
  const url = websiteId
    ? `http://localhost:3000/api/gsc/connect?websiteId=${websiteId}`
    : 'http://localhost:3000/api/gsc/connect';
  return new Request(url) as unknown as NextRequest;
}

describe('GET /api/gsc/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest('w1'));

    expect(res.status).toBe(401);
  });

  it('returns 400 when websiteId is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
  });

  it('returns 400 when websiteId does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new WebsiteNotFoundError('not found')
    );

    const res = await GET(makeRequest('foreign-id'));

    expect(res.status).toBe(400);
  });

  it('redirects to Google and sets both cookies for a valid websiteId', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1' },
      websites: [{ id: 'w1' }],
    });

    const res = await GET(makeRequest('w1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://accounts.google.com/o/oauth2/mock');
    const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
    const cookieString = setCookies.join('; ');
    expect(cookieString).toContain('gsc_oauth_state=');
    expect(cookieString).toContain('gsc_oauth_website_id=w1');
  });
});
