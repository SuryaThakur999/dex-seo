import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { ActionDecisionError, decideAction } from '@/lib/action-decision';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { customer: { findUnique: vi.fn() } } }));
vi.mock('@/lib/action-decision', () => ({ ActionDecisionError: class ActionDecisionError extends Error { constructor(public status: number, message: string) { super(message); } }, decideAction: vi.fn() }));

describe('approve action route', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('requires an authenticated customer', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const response = await POST(new Request('http://localhost') as never, { params: { actionId: 'action-1' } });
    expect(response.status).toBe(401);
    expect(decideAction).not.toHaveBeenCalled();
  });

  it('delegates the decision and revision, preserving the redirect', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'clerk-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(decideAction).mockResolvedValue({ actionId: 'action-1' });
    const form = new FormData();
    form.set('expectedRevision', 'revision-1');
    const response = await POST(new Request('http://localhost/api/actions/action-1/approve', { method: 'POST', body: form }) as never, { params: { actionId: 'action-1' } });
    expect(response.status).toBe(303);
    expect(decideAction).toHaveBeenCalledWith({ customerId: 'customer-1', actorClerkUserId: 'clerk-1', actionId: 'action-1', decision: 'approve', expectedRevision: 'revision-1' });
  });

  it('returns the service conflict status', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'clerk-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(decideAction).mockRejectedValue(new ActionDecisionError(409, 'Action changed. Reload before deciding.'));
    const response = await POST(new Request('http://localhost', { method: 'POST' }) as never, { params: { actionId: 'action-1' } });
    expect(response.status).toBe(409);
  });
});
