import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findFirst: vi.fn() },
    competitorEntity: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
import { db } from '@/lib/db';

function params() {
  return { params: { id: 'profile_1', competitorId: 'comp_1' } };
}

describe('PATCH /api/client-profile/[id]/competitors/[competitorId]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const req = new NextRequest('http://test/x', { method: 'PATCH', body: JSON.stringify({ classification: 'direct' }) });
    const res = await PATCH(req, params());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the competitor does not belong to the owned profile', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://test/x', { method: 'PATCH', body: JSON.stringify({ classification: 'direct' }) });
    const res = await PATCH(req, params());
    expect(res.status).toBe(404);
  });

  it('overrides the classification and marks it user-confirmed', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'comp_1' });
    (db.competitorEntity.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'comp_1', classification: 'indirect' });
    const req = new NextRequest('http://test/x', { method: 'PATCH', body: JSON.stringify({ classification: 'indirect' }) });
    const res = await PATCH(req, params());
    expect(res.status).toBe(200);
    expect(db.competitorEntity.update).toHaveBeenCalledWith({
      where: { id: 'comp_1' },
      data: { classification: 'indirect', classificationReason: 'Manually corrected by user.', userConfirmed: true },
    });
  });

  it('rejects an invalid classification value with 400', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'comp_1' });
    const req = new NextRequest('http://test/x', { method: 'PATCH', body: JSON.stringify({ classification: 'bogus' }) });
    const res = await PATCH(req, params());
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/client-profile/[id]/competitors/[competitorId]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes the competitor when owned', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'comp_1' });
    const res = await DELETE(new NextRequest('http://test/x', { method: 'DELETE' }), params());
    expect(res.status).toBe(204);
    expect(db.competitorEntity.delete).toHaveBeenCalledWith({ where: { id: 'comp_1' } });
  });

  it('returns 404 when the competitor does not belong to the owned profile', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await DELETE(new NextRequest('http://test/x', { method: 'DELETE' }), params());
    expect(res.status).toBe(404);
  });
});
