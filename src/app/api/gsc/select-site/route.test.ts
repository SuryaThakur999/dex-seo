import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites, GoogleAuthError, GoogleConfigError } from '@/lib/gsc-client';

vi.mock('@/lib/db', () => ({
  db: { website: { update: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn((v: string) => `decrypted:${v}`) }));

vi.mock('@/lib/gsc-client', () => ({
  listVerifiedSites: vi.fn(),
  GoogleAuthError: class GoogleAuthError extends Error {},
  GoogleConfigError: class GoogleConfigError extends Error {},
}));

function makeRequest(fields: Record<string, string>): NextRequest {
  const form = new URLSearchParams(fields);
  return new Request('http://localhost:3000/api/gsc/select-site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }) as unknown as NextRequest;
}

describe('POST /api/gsc/select-site', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(401);
  });

  it('updates the website named by an explicit websiteId field, not the default', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w2', gscRefreshToken: 'token-2' },
      websites: [{ id: 'w1' }, { id: 'w2' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockResolvedValue(['https://acme.com']);

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com', websiteId: 'w2' }));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'w2');
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w2' },
      data: { gscPropertyUrl: 'https://acme.com', gscReconnectRequired: false },
    });
    expect(res.status).toBe(303);
  });

  it('falls back to the default website when websiteId is absent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'token-1' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockResolvedValue(['https://acme.com']);

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', undefined);
    expect(db.website.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { gscPropertyUrl: 'https://acme.com', gscReconnectRequired: false },
    });
    expect(res.status).toBe(303);
  });

  it('returns 404 when websiteId does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com', websiteId: 'someone-elses-website' }));

    expect(res.status).toBe(404);
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the property is not verified for this account', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'token-1' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockResolvedValue(['https://other.com']);

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(400);
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 500 without touching the DB when the stored token fails to decrypt', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'corrupted' },
      websites: [{ id: 'w1' }],
    });
    (decrypt as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Invalid ciphertext payload format');
    });

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(500);
    expect(listVerifiedSites).not.toHaveBeenCalled();
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('flags reconnect-required and returns 400 when Google rejects the token itself, without clearing it', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'dead-token' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockRejectedValue(new GoogleAuthError('invalid_grant'));

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('no longer valid');
    // Anchored on the ciphertext that actually failed, so a concurrent
    // successful reconnect (which changes gscRefreshToken) can't be
    // overwritten by this stale failure.
    expect(db.website.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', gscRefreshToken: 'dead-token' },
      data: { gscReconnectRequired: true },
    });
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 503 without touching the token when Google rejects our OAuth client, not the token', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'token-1' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockRejectedValue(new GoogleConfigError('invalid_client'));

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(503);
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 503 without clearing the token on a transient Google failure', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'token-1' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('sites.list timed out after 10000ms'));

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(503);
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 500 when the verified match cannot be persisted', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', gscRefreshToken: 'token-1' },
      websites: [{ id: 'w1' }],
    });
    (listVerifiedSites as ReturnType<typeof vi.fn>).mockResolvedValue(['https://acme.com']);
    (db.website.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection reset'));

    const res = await POST(makeRequest({ siteUrl: 'https://acme.com' }));

    expect(res.status).toBe(500);
  });
});
