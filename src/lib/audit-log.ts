import type { Prisma } from '@prisma/client';
import { db } from './db';

export type AuditEventType = 'action_decided' | 'action_batch_decided' | 'action_reverted' | 'auto_execute_toggled';

type AuditEntryOptions = { id?: string; createdAt?: Date };

export function buildAuditLogEntryArgs(
  customerId: string,
  eventType: AuditEventType,
  detail: Record<string, unknown>,
  actionId?: string,
  options: AuditEntryOptions = {}
) {
  return {
    data: { customerId, eventType, actionId, detail: detail as unknown as Prisma.InputJsonValue, ...options },
  };
}

export async function logAuditEvent(
  customerId: string,
  eventType: AuditEventType,
  detail: Record<string, unknown>,
  actionId?: string
): Promise<void> {
  await db.auditLogEntry.create(buildAuditLogEntryArgs(customerId, eventType, detail, actionId));
}
