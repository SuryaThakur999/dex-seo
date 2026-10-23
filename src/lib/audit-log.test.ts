import { describe, it, expect, vi } from 'vitest';
import { logAuditEvent } from './audit-log';
import { db } from './db';

vi.mock('./db', () => ({
  db: {
    auditLogEntry: {
      create: vi.fn(),
    },
  },
}));

describe('logAuditEvent', () => {
  it('creates an audit log entry with the given customer, event type, detail, and optional actionId', async () => {
    await logAuditEvent('cust_1', 'auto_execute_toggled', { enabled: true }, undefined);

    expect(db.auditLogEntry.create).toHaveBeenCalledWith({
      data: { customerId: 'cust_1', eventType: 'auto_execute_toggled', actionId: undefined, detail: { enabled: true } },
    });
  });

  it('includes actionId when provided', async () => {
    await logAuditEvent('cust_1', 'action_decided', { decision: 'approved' }, 'action_1');

    expect(db.auditLogEntry.create).toHaveBeenCalledWith({
      data: { customerId: 'cust_1', eventType: 'action_decided', actionId: 'action_1', detail: { decision: 'approved' } },
    });
  });
});
