import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: { clientProfile: { findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/client-profile/profile_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('PATCH /api/client-profile/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await PATCH(makeRequest({ brandVoice: 'Warm' }), { params: { id: 'profile_1' } });
    expect(res.status).toBe(401);
  });

  it('returns 403 when the profile is not owned by the caller', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await PATCH(makeRequest({ brandVoice: 'Warm' }), { params: { id: 'profile_1' } });
    expect(res.status).toBe(403);
    // Assert the real where-clause, not just the mocked null response — a
    // dropped ownership scope would still 403 here if the mock weren't checked.
    expect(db.clientProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'profile_1', customer: { clerkUserId: 'user_1' } },
    });
  });

  it('updates brandVoice and audience for the owning customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1', brandVoice: 'Warm' });

    const res = await PATCH(makeRequest({ brandVoice: 'Warm', audience: 'SMB founders' }), { params: { id: 'profile_1' } });

    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile_1' },
      data: { brandVoice: 'Warm', audience: 'SMB founders' },
    });
    expect(res.status).toBe(200);
  });

  it('trims and drops empty entries from approvedClaims/restrictedWording', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await PATCH(
      makeRequest({ approvedClaims: [' Trusted by 500+ teams ', '', '  '], restrictedWording: ['guaranteed'] }),
      { params: { id: 'profile_1' } }
    );

    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile_1' },
      data: { approvedClaims: ['Trusted by 500+ teams'], restrictedWording: ['guaranteed'] },
    });
  });

  it('rejects a non-array approvedClaims with a 400', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });

    const res = await PATCH(makeRequest({ approvedClaims: 'not an array' }), { params: { id: 'profile_1' } });

    expect(res.status).toBe(400);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('rejects a brandVoice over the length cap with a 400', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });

    const res = await PATCH(makeRequest({ brandVoice: 'a'.repeat(2001) }), { params: { id: 'profile_1' } });

    expect(res.status).toBe(400);
  });

  it('updates markets and languages, reusing the same list validation as approvedClaims', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await PATCH(makeRequest({ markets: ['Germany', ' United States ', ''], languages: ['German', 'English'] }), {
      params: { id: 'profile_1' },
    });

    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile_1' },
      data: { markets: ['Germany', 'United States'], languages: ['German', 'English'] },
    });
  });

  it('only updates fields present in the request body', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await PATCH(makeRequest({ brandVoice: 'Warm' }), { params: { id: 'profile_1' } });

    expect(db.clientProfile.update).toHaveBeenCalledWith({ where: { id: 'profile_1' }, data: { brandVoice: 'Warm' } });
  });
});
