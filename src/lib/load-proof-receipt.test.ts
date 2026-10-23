import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionWithOwnedWebsiteAndGuard } from './proof-receipt';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), build: vi.fn() }));
vi.mock('./db', () => ({ db: { auditLogEntry: { findMany: mocks.findMany } } }));
vi.mock('./proof-receipt', () => ({ buildProofReceipt: mocks.build }));
import { loadProofReceipt } from './load-proof-receipt';

const action = {
  id: 'action_1', customerId: 'owner', websiteId: 'site_1',
  website: { id: 'site_1', clientProfileId: 'profile_1', clientProfile: { id: 'profile_1', customerId: 'owner' } },
} as ActionWithOwnedWebsiteAndGuard;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.build.mockReturnValue({ limitations: [], events: [] });
});

describe('loadProofReceipt', () => {
  it('bounds and scopes history to the owned action and customer', async () => {
    await loadProofReceipt(action, 'owner');
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: 'owner', actionId: 'action_1' },
      take: 101, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('rejects foreign or inconsistent ownership before reading history', async () => {
    await expect(loadProofReceipt(action, 'other')).rejects.toThrow('Receipt not found');
    await expect(loadProofReceipt({ ...action, website: { ...action.website,
      clientProfile: { id: 'profile_1', customerId: 'other' },
    } }, 'owner')).rejects.toThrow('Receipt not found');
    await expect(loadProofReceipt({ ...action, websiteId: 'other_site' }, 'owner')).rejects.toThrow('Receipt not found');
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('discloses truncation and passes only 100 serialized events to the adapter', async () => {
    const createdAt = new Date('2026-10-11T19:00:00.000Z');
    mocks.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({
      id: String(index), customerId: 'owner', actionId: 'action_1', eventType: 'action_approved', createdAt, detail: {},
    })));
    const result = await loadProofReceipt(action, 'owner');
    const input = mocks.build.mock.calls[0][0];
    expect(input.events).toHaveLength(100);
    expect(input.events[0].createdAt).toBe(createdAt.toISOString());
    expect(result.limitations).toContain('Showing the latest 100 history events. Older events are not included.');
  });
});
