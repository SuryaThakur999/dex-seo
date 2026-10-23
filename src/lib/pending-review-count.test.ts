import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPendingReviewCount } from './pending-review-count';
import { db } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { count: vi.fn() },
  },
}));

describe('getPendingReviewCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when no customer exists for this clerkUserId (no fabricated count)', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const count = await getPendingReviewCount('user_1');

    expect(count).toBe(0);
    expect(db.action.count).not.toHaveBeenCalled();
  });

  it('returns the real pending-action count, scoped to this customer only', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust_1' });
    (db.action.count as ReturnType<typeof vi.fn>).mockResolvedValue(7);

    const count = await getPendingReviewCount('user_1');

    expect(count).toBe(7);
    expect(db.action.count).toHaveBeenCalledWith({ where: { customerId: 'cust_1', status: 'pending' } });
  });
});
