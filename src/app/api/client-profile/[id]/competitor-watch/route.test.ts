import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findFirst: vi.fn() },
    competitorEntity: { findMany: vi.fn() },
    evidenceItem: { findMany: vi.fn() },
  },
}));
import { db } from '@/lib/db';

function params() {
  return { params: { id: 'profile_1' } };
}

const retrievedAt = new Date('2026-10-14T00:00:00Z');

describe('GET /api/client-profile/[id]/competitor-watch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitor-watch'), params());
    expect(res.status).toBe(401);
  });

  it('returns 403 when the profile is not owned by this customer', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitor-watch'), params());
    expect(res.status).toBe(403);
  });

  it('returns no items when the profile has no tracked competitors', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitor-watch'), params());
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(db.evidenceItem.findMany).not.toHaveBeenCalled();
  });

  it('returns only real detected changes (priorContentHash present), excluding first-observation baselines, enriched with the competitor name', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'comp_1', name: 'Acme Co' }]);
    (db.evidenceItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ev_changed', entityId: 'comp_1', canonicalUrl: 'https://acme.test/pricing', excerpt: 'New pricing tiers.',
        retrievedAt, observedMetrics: { contentHash: 'h2', priorContentHash: 'h1', priorRetrievedAt: '2026-10-07T00:00:00Z' },
      },
      {
        id: 'ev_baseline', entityId: 'comp_1', canonicalUrl: 'https://acme.test', excerpt: 'Homepage copy.',
        retrievedAt, observedMetrics: { contentHash: 'h0', priorContentHash: null, priorRetrievedAt: null },
      },
    ]);

    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitor-watch'), params());
    const body = await res.json();

    expect(body.items).toEqual([{
      id: 'ev_changed', competitorName: 'Acme Co', canonicalUrl: 'https://acme.test/pricing',
      excerpt: 'New pricing tiers.', retrievedAt: retrievedAt.toISOString(),
    }]);
  });

  it('falls back to an honest "Unknown competitor" label if the competitor entity no longer resolves', async () => {
    (auth as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'profile_1' });
    (db.competitorEntity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'comp_1', name: 'Acme Co' }]);
    (db.evidenceItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ev_orphan', entityId: 'comp_deleted', canonicalUrl: 'https://old.test', excerpt: 'Old excerpt.',
        retrievedAt, observedMetrics: { contentHash: 'h2', priorContentHash: 'h1', priorRetrievedAt: '2026-10-07T00:00:00Z' },
      },
    ]);

    const res = await GET(new NextRequest('http://test/api/client-profile/profile_1/competitor-watch'), params());
    const body = await res.json();

    expect(body.items[0].competitorName).toBe('Unknown competitor');
  });
});
