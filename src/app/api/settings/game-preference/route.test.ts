import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: { customer: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

function makeRequest(gamePreference: unknown): NextRequest {
  return new Request('http://localhost:3000/api/settings/game-preference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gamePreference }),
  }) as unknown as NextRequest;
}

describe('POST /api/settings/game-preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest('disabled'));

    expect(res.status).toBe(401);
  });

  it('returns 400 for a value outside the real enum', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });

    const res = await POST(makeRequest('always_dance'));

    expect(res.status).toBe(400);
    expect(db.customer.update).not.toHaveBeenCalled();
  });

  it('returns 404 when no customer row exists for this user', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await POST(makeRequest('disabled'));

    expect(res.status).toBe(404);
  });

  it('updates the real Customer.gamePreference for each valid enum value', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust_1' });

    for (const value of ['ask', 'always_game', 'always_watch', 'disabled']) {
      const res = await POST(makeRequest(value));
      expect(res.status).toBe(200);
      expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 'cust_1' }, data: { gamePreference: value } });
    }
  });
});
