import { db } from '@/lib/db';

// Shared by every app-shell layout's nav badge (desktop tooltip + mobile bottom nav) so the
// count is one real query, not duplicated per layout — DEX CONTINUATION MASTER DIRECTIVE:
// "Bind every metric and chart to real data."
export async function getPendingReviewCount(clerkUserId: string): Promise<number> {
  const customer = await db.customer.findUnique({ where: { clerkUserId } });
  if (!customer) return 0;
  return db.action.count({ where: { customerId: customer.id, status: 'pending' } });
}
