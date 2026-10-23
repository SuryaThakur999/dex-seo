import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { exchangeCodeForRefreshToken } from '@/lib/google-oauth';
import { encrypt } from '@/lib/crypto';

vi.mock('@/lib/db', () => ({
  db: { website: { update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/google-oauth', () => ({ exchangeCodeForRefreshToken: vi.fn() }));

vi.mock('@/lib/crypto', () => ({ encrypt: vi.fn((v: string) => `encrypted:${v}`) }));

function makeRequest(
  params: { code?: string; state?: string; error?: string },
  cookies: Record<string, string>
): NextRequest {
  const search = new URLSearchParams();
  if (params.code) search.set('code', params.code);
  if (params.state) search.set('state', params.state);
  if (params.error) search.set('error', params.error);
  const req = new Request(`http://localhost:3000/api/gsc/callback?${search.toString()}`) as unknown as NextRequest;
  (req as unknown as { cookies: { get: (name: string) => { value: string } | undefined } }).cookies = {
    get: (name: string) => (cookies[name] !== undefined ? { value: cookies[name] } : undefined),
  };
  return req;
}

describe('GET /api/gsc/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w1' }));

    expect(res.status).toBe(401);
  });

  it('redirects to settings with an honest "declined" message when the customer denies consent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(
      makeRequest({ error: 'access_denied' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w1' })
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/settings?gsc=declined');
    expect(exchangeCodeForRefreshToken).not.toHaveBeenCalled();
  });

  it('redirects to settings with a generic error message for any other Google OAuth error', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(
      makeRequest({ error: 'server_error' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w1' })
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/settings?gsc=error');
    expect(exchangeCodeForRefreshToken).not.toHaveBeenCalled();
  });

  it('returns 400 when the gsc_oauth_website_id cookie is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 when state does not match', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await GET(
      makeRequest({ code: 'c', state: 'wrong' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w1' })
    );

    expect(res.status).toBe(400);
  });

  it('stores the token on the website named by the cookie, not the default', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (exchangeCodeForRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue('raw-refresh-token');
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w2' },
      websites: [{ id: 'w1' }, { id: 'w2' }],
    });

    const res = await GET(
      makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w2' })
    );

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'w2');
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w2' },
      data: { gscRefreshToken: 'encrypted:raw-refresh-token', gscReconnectRequired: false },
    });
    expect(res.status).toBe(307);
  });

  it('preserves the existing website row when Google does not return a refresh token (cancelled or failed consent)', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (exchangeCodeForRefreshToken as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No refresh_token in token response'));
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1' },
      websites: [{ id: 'w1' }],
    });

    const res = await GET(
      makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w1' })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('did not return a refresh token');
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the websiteId from the cookie is no longer valid', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (exchangeCodeForRefreshToken as ReturnType<typeof vi.fn>).mockResolvedValue('raw-refresh-token');
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('gone'));

    const res = await GET(
      makeRequest({ code: 'c', state: 's' }, { gsc_oauth_state: 's', gsc_oauth_website_id: 'w2' })
    );

    expect(res.status).toBe(400);
  });
});
