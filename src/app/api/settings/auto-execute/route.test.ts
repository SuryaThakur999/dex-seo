import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    website: { update: vi.fn() },
    auditLogEntry: { create: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

function makeRequest(enabled: boolean, websiteId = 'web_1'): NextRequest {
  return new Request('http://localhost:3000/api/settings/auto-execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, websiteId }),
  }) as unknown as NextRequest;
}

describe('POST /api/settings/auto-execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest(true));

    expect(res.status).toBe(401);
  });

  it('returns 404 when websiteId does not belong to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeRequest(true, 'foreign-id'));

    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('toggles autoExecuteEnabled and records an audit event', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_1' },
      website: { id: 'web_1' },
      websites: [],
    });

    const res = await POST(makeRequest(true, 'web_1'));

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'web_1');
    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.website.update).toHaveBeenCalledWith({ where: { id: 'web_1' }, data: { autoExecuteEnabled: true } });
    expect(db.auditLogEntry.create).toHaveBeenCalledWith({
      data: {
        customerId: 'cust_1',
        eventType: 'auto_execute_toggled',
        actionId: undefined,
        detail: expect.objectContaining({ enabled: true, websiteId: 'web_1' }),
      },
    });
  });
});
