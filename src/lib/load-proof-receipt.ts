import { db } from './db';
import { buildProofReceipt, type ActionWithOwnedWebsiteAndGuard, type ReceiptView } from './proof-receipt';

export async function loadProofReceipt(action: ActionWithOwnedWebsiteAndGuard, customerId: string): Promise<ReceiptView> {
  if (action.customerId !== customerId || action.websiteId !== action.website.id ||
      action.website.clientProfileId !== action.website.clientProfile.id ||
      action.website.clientProfile.customerId !== customerId) {
    throw new Error('Receipt not found');
  }

  const entries = await db.auditLogEntry.findMany({
    where: { customerId, actionId: action.id },
    take: 101,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, customerId: true, actionId: true, eventType: true, createdAt: true, detail: true },
  });
  const receipt = buildProofReceipt({
    action,
    events: entries.slice(0, 100).map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  });
  if (entries.length > 100) {
    receipt.limitations.push('Showing the latest 100 history events. Older events are not included.');
  }
  return receipt;
}
