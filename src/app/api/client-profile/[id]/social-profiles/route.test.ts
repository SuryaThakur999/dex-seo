import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
import { db } from '@/lib/db';

function params() {
  return { params: { id: 'profile_1' } };
}

function patchRequest(body: unknown) {
  return new NextRequest('http://test/api/client-profile/profile_1/social-profiles', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/client-profile/[id]/social-profiles (social-profile-discovery plan, 2026-10-17)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await PATCH(patchRequest({ socialProfiles: [] }), params());
    expect(res.status).toBe(401);
  });

  it('returns 403 when the profile is not owned by this customer', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await PATCH(patchRequest({ socialProfiles: [] }), params());
    expect(res.status).toBe(403);
  });

  it('updates ClientProfile.socialProfiles with a valid list', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1', socialProfiles: [{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }] });

    const res = await PATCH(patchRequest({ socialProfiles: [{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }] }), params());

    expect(res.status).toBe(200);
    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile_1' },
      data: { socialProfiles: [{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }] },
    });
  });

  it('returns 400 for a malformed entry', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });

    const res = await PATCH(patchRequest({ socialProfiles: [{ platform: 'myspace', url: 'https://myspace.com/acme' }] }), params());

    expect(res.status).toBe(400);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('accepts an empty list (removing all channels)', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1', socialProfiles: [] });

    const res = await PATCH(patchRequest({ socialProfiles: [] }), params());

    expect(res.status).toBe(200);
    expect(db.clientProfile.update).toHaveBeenCalledWith({ where: { id: 'profile_1' }, data: { socialProfiles: [] } });
  });
});
