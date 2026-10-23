import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { clientProfile: { findFirst: vi.fn() } } }));
vi.mock('@/lib/research/competitor-watch-job', () => ({ runCompetitorWatch: vi.fn() }));
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { runCompetitorWatch } from '@/lib/research/competitor-watch-job';
import { POST } from './route';

describe('POST /api/client-profile/[id]/competitor-watch/check-now', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('401s when unauthenticated', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const res = await POST(new Request('http://x') as never, { params: { id: 'profile_1' } });
    expect(res.status).toBe(401);
  });

  it('403s when the profile is not owned by this customer', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(null);
    const res = await POST(new Request('http://x') as never, { params: { id: 'profile_1' } });
    expect(res.status).toBe(403);
    expect(runCompetitorWatch).not.toHaveBeenCalled();
  });

  it('runs the real job for an owned profile and returns its real changed count', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue({ id: 'profile_1' } as never);
    vi.mocked(runCompetitorWatch).mockResolvedValue({ changed: ['e1', 'e2'] } as never);
    const res = await POST(new Request('http://x') as never, { params: { id: 'profile_1' } });
    expect(runCompetitorWatch).toHaveBeenCalledWith('profile_1');
    expect(await res.json()).toEqual({ changed: 2 });
  });
});
