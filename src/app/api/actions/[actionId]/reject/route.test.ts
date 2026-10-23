import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { decideAction } from '@/lib/action-decision';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { customer: { findUnique: vi.fn() } } }));
vi.mock('@/lib/action-decision', () => ({ ActionDecisionError: class ActionDecisionError extends Error { constructor(public status: number, message: string) { super(message); } }, decideAction: vi.fn() }));

describe('reject action route', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('requires authentication', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    const response = await POST(new Request('http://localhost') as never, { params: { actionId: 'action-1' } });
    expect(response.status).toBe(401);
  });

  it('delegates rejection with the submitted revision', async () => {
    vi.mocked(auth).mockReturnValue({ userId: 'clerk-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(decideAction).mockResolvedValue({ actionId: 'action-1' });
    const form = new FormData();
    form.set('expectedRevision', 'revision-1');
    const response = await POST(new Request('http://localhost/api/actions/action-1/reject', { method: 'POST', body: form }) as never, { params: { actionId: 'action-1' } });
    expect(response.status).toBe(303);
    expect(decideAction).toHaveBeenCalledWith({ customerId: 'customer-1', actorClerkUserId: 'clerk-1', actionId: 'action-1', decision: 'reject', expectedRevision: 'revision-1' });
  });
});
