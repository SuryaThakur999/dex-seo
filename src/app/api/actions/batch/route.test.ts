import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { decideActionBatch } from '@/lib/action-batch';
import { ActionDecisionError } from '@/lib/action-decision';
import { POST } from './route';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { customer: { findUnique: vi.fn() } } }));
vi.mock('@/lib/action-batch', async original => ({ ...await original<typeof import('@/lib/action-batch')>(), decideActionBatch: vi.fn() }));

const body = { requestId: 'ceace7bf-38a0-45a6-932d-bf8ab38023e3', websiteId: 'website-1', decision: 'approve',
  items: [{ actionId: 'a', revision: 'a'.repeat(64) }, { actionId: 'b', revision: 'b'.repeat(64) }] };
const request = (text = JSON.stringify(body)) => new Request('http://localhost/api/actions/batch', { method: 'POST', body: text });
describe('batch route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(auth).mockReturnValue({ userId: 'clerk-1' } as never);
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'customer-1' } as never);
  });
  it('requires authentication', async () => {
    vi.mocked(auth).mockReturnValue({ userId: null } as never);
    expect((await POST(request())).status).toBe(401);
    expect(decideActionBatch).not.toHaveBeenCalled();
  });
  it('requires a customer record', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
  });
  it.each(['{', JSON.stringify({ ...body, extra: true }), ' '.repeat(65537) + JSON.stringify(body)])('rejects invalid or oversized raw JSON', async text => {
    expect((await POST(request(text))).status).toBe(400);
    expect(decideActionBatch).not.toHaveBeenCalled();
  });
  it('returns the persisted batch result and binds the authenticated actor', async () => {
    const result = { requestId: body.requestId, decision: 'approve' as const, actionIds: ['a', 'b'] };
    vi.mocked(decideActionBatch).mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(decideActionBatch).toHaveBeenCalledWith({ customerId: 'customer-1', actorClerkUserId: 'clerk-1', request: body });
  });
  it.each([400, 404, 409] as const)('preserves the service status %s', async status => {
    vi.mocked(decideActionBatch).mockRejectedValue(new ActionDecisionError(status, 'Decision refused'));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Decision refused' });
  });
  it('does not convert an unexpected persistence failure into success', async () => {
    vi.mocked(decideActionBatch).mockRejectedValue(new Error('Persistence failed'));
    await expect(POST(request())).rejects.toThrow('Persistence failed');
  });
  it('bounds UTF-8 bytes rather than character count', async () => {
    const text = JSON.stringify({ ...body, websiteId: 'é'.repeat(33000) });
    expect(text.length).toBeLessThan(65536);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(65536);
    expect((await POST(request(text))).status).toBe(400);
    expect(decideActionBatch).not.toHaveBeenCalled();
  });
});
