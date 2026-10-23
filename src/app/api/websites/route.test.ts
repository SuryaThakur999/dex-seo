import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest } from '@/lib/customer';
import { createWebsiteWithEntitlementCheck, createClientProfileWithEntitlementCheck, EntitlementLimitError, DuplicateWebsiteError } from '@/lib/entitlements';

vi.mock('@/lib/db', () => ({
  db: { website: { update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
}));

vi.mock('@/lib/entitlements', () => ({
  createWebsiteWithEntitlementCheck: vi.fn(),
  createClientProfileWithEntitlementCheck: vi.fn(),
  normalizeSiteUrl: (rawUrl: string) => {
    let host: string;
    try {
      host = new URL(rawUrl).hostname;
    } catch {
      host = rawUrl.replace(/^https?:\/\//, '').split('/')[0];
    }
    return host.toLowerCase().replace(/^www\./, '');
  },
  EntitlementLimitError: class EntitlementLimitError extends Error {},
  DuplicateWebsiteError: class DuplicateWebsiteError extends Error {},
}));

function makeRequest(url: string): NextRequest {
  return new Request('http://localhost:3000/api/websites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }) as unknown as NextRequest;
}

function makeRequestWithBody(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/websites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/websites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest('https://newsite.com'));

    expect(res.status).toBe(401);
  });

  it('returns 400 when url is missing', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await POST(makeRequest(''));

    expect(res.status).toBe(400);
  });

  it('creates a brand-new client profile for mode "new_company" (the default, unchanged contract for WebsiteEntryPanel\'s quick-add), named from the real host', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: null, normalizedHost: 'a.test' }],
    });
    (createClientProfileWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_new' });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w2',
      url: 'https://newsite.com',
      clientProfileId: 'profile_new',
    });

    const res = await POST(makeRequest('https://newsite.com'));
    const body = await res.json();

    expect(createClientProfileWithEntitlementCheck).toHaveBeenCalledWith({ customerId: 'cust_1', name: 'newsite.com' });
    expect(createWebsiteWithEntitlementCheck).toHaveBeenCalledWith({ clientProfileId: 'profile_new', url: 'https://newsite.com' });
    expect(res.status).toBe(201);
    expect(body).toEqual({ id: 'w2', url: 'https://newsite.com', clientProfileId: 'profile_new', gscInherited: false, reused: false });
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('attaches to an existing client profile for mode "existing_company" and inherits that company\'s GSC token', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: 'encrypted-token', normalizedHost: 'a.test' }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w2',
      url: 'https://newsite.com',
      clientProfileId: 'profile_1',
    });

    const res = await POST(makeRequestWithBody({ url: 'https://newsite.com', mode: 'existing_company', clientProfileId: 'profile_1' }));
    const body = await res.json();

    expect(createClientProfileWithEntitlementCheck).not.toHaveBeenCalled();
    expect(createWebsiteWithEntitlementCheck).toHaveBeenCalledWith({ clientProfileId: 'profile_1', url: 'https://newsite.com' });
    expect(res.status).toBe(201);
    expect(body).toEqual({ id: 'w2', url: 'https://newsite.com', clientProfileId: 'profile_1', gscInherited: true, reused: false });
    expect(db.website.update).toHaveBeenCalledWith({ where: { id: 'w2' }, data: { gscRefreshToken: 'encrypted-token' } });
  });

  it('rejects mode "existing_company" naming a client profile this customer does not own (tenant isolation)', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', normalizedHost: 'a.test' }],
    });

    const res = await POST(makeRequestWithBody({ url: 'https://newsite.com', mode: 'existing_company', clientProfileId: 'someone_elses_profile' }));

    expect(res.status).toBe(400);
    expect(createWebsiteWithEntitlementCheck).not.toHaveBeenCalled();
  });

  it('does not inherit a sibling token flagged reconnect-required, leaving the new site unconnected', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: 'dead-encrypted-token', gscReconnectRequired: true, normalizedHost: 'a.test' }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w2',
      url: 'https://newsite.com',
      clientProfileId: 'profile_1',
    });

    const res = await POST(makeRequestWithBody({ url: 'https://newsite.com', mode: 'existing_company', clientProfileId: 'profile_1' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: 'w2', url: 'https://newsite.com', clientProfileId: 'profile_1', gscInherited: false, reused: false });
    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('scopes GSC-token inheritance to siblings of the TARGET company only, never across companies', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_a' },
      websites: [
        { id: 'w_a', clientProfileId: 'profile_a', normalizedHost: 'a.test', gscRefreshToken: 'tok_a', gscReconnectRequired: false },
        { id: 'w_b', clientProfileId: 'profile_b', normalizedHost: 'b.test', gscRefreshToken: null, gscReconnectRequired: false },
      ],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'w_new',
      url: 'https://c.test',
      clientProfileId: 'profile_b',
    });

    await POST(makeRequestWithBody({ url: 'https://c.test', mode: 'existing_company', clientProfileId: 'profile_b' }));

    expect(db.website.update).not.toHaveBeenCalled();
  });

  it('returns 400 with the message when the client-profile entitlement limit is hit for mode "new_company"', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: null, normalizedHost: 'a.test' }],
    });
    (createClientProfileWithEntitlementCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new EntitlementLimitError('This workspace already has 3 of 3 allowed client profiles.')
    );

    const res = await POST(makeRequest('https://newsite.com'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('This workspace already has 3 of 3 allowed client profiles.');
    expect(createWebsiteWithEntitlementCheck).not.toHaveBeenCalled();
  });

  it('returns 400 with the message when the per-company website limit is hit', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: null, normalizedHost: 'a.test' }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new EntitlementLimitError('This client profile already has 3 of 3 allowed websites.')
    );

    const res = await POST(makeRequestWithBody({ url: 'https://newsite.com', mode: 'existing_company', clientProfileId: 'profile_1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('This client profile already has 3 of 3 allowed websites.');
  });

  it('reuses an existing website with the same host instead of erroring', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [
        { id: 'w1', clientProfileId: 'profile_1', url: 'https://newsite.com', normalizedHost: 'newsite.com', gscRefreshToken: null },
      ],
    });

    const res = await POST(makeRequest('https://newsite.com'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ id: 'w1', url: 'https://newsite.com', clientProfileId: 'profile_1', reused: true });
    expect(createWebsiteWithEntitlementCheck).not.toHaveBeenCalled();
    expect(createClientProfileWithEntitlementCheck).not.toHaveBeenCalled();
  });

  it('still surfaces a DuplicateWebsiteError from a concurrent-create race as an error', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'w1', clientProfileId: 'profile_1' },
      websites: [{ id: 'w1', clientProfileId: 'profile_1', gscRefreshToken: null, normalizedHost: 'a.test' }],
    });
    (createWebsiteWithEntitlementCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DuplicateWebsiteError('newsite.com is already registered on this client profile.')
    );

    const res = await POST(makeRequestWithBody({ url: 'https://newsite.com', mode: 'existing_company', clientProfileId: 'profile_1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('newsite.com is already registered on this client profile.');
  });
});
