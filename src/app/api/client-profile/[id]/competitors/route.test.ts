import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findFirst: vi.fn() },
    competitorEntity: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));
import { db } from '@/lib/db';

function params() {
  return { params: { id: 'profile_1' } };
}

describe('GET /api/client-profile/[id]/competitors', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitors'), params());
    expect(res.status).toBe(401);
  });

  it('returns 403 when the profile is not owned by this customer', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitors'), params());
    expect(res.status).toBe(403);
  });

  it('lists competitor entities for the owned profile', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'comp_1', name: 'Acme' }]);
    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitors'), params());
    const body = await res.json();
    expect(body.competitors).toEqual([{ id: 'comp_1', name: 'Acme' }]);
  });
});

describe('POST /api/client-profile/[id]/competitors', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects a missing name with 400', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    const req = new NextRequest('http://test/api/client-profile/profile_1/competitors', {
      method: 'POST', body: JSON.stringify({}),
    });
    const res = await POST(req, params());
    expect(res.status).toBe(400);
  });

  it('creates a competitor entity classified against existing entities', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.competitorEntity.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'comp_1', name: 'Acme Bakery' });
    const req = new NextRequest('http://test/api/client-profile/profile_1/competitors', {
      method: 'POST', body: JSON.stringify({ name: 'Acme Bakery', canonicalDomain: 'acme-bakery.test' }),
    });
    const res = await POST(req, params());
    expect(res.status).toBe(201);
    expect(db.competitorEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientProfileId: 'profile_1', name: 'Acme Bakery', source: 'user_added', userConfirmed: true }),
    }));
  });
});
