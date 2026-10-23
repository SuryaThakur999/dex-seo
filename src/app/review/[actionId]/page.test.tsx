import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ customer: vi.fn(), action: vi.fn(), receipt: vi.fn(), notFound: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: () => ({ userId: 'clerk_owner' }) }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/lib/db', () => ({ db: { customer: { findUnique: mocks.customer }, action: { findUnique: mocks.action } } }));
vi.mock('@/lib/load-proof-receipt', () => ({ loadProofReceipt: mocks.receipt }));
import ActionDetailPage from './page';

const ownedAction = {
  id: 'action_1', customerId: 'owner', websiteId: 'site_1',
  website: { id: 'site_1', clientProfileId: 'profile_1', clientProfile: { id: 'profile_1', customerId: 'owner' } },
  status: 'approved', createdAt: new Date(), decidedAt: null, guardResult: null,
};

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.resetAllMocks();
  mocks.customer.mockResolvedValue({ id: 'owner' });
  mocks.action.mockResolvedValue(ownedAction);
  mocks.receipt.mockResolvedValue({ basis: 'saved_snapshot' });
  mocks.notFound.mockImplementation(() => { throw new Error('404'); });
});

describe('Mobile action detail page', () => {
  it('preserves queue scope in an accessible back link', async () => {
    const tree = await ActionDetailPage({ params: { actionId: 'action_1' }, searchParams: {
      clientProfileId: 'profile_1', websiteId: 'site_1', type: 'meta_description',
    } });
    const link = tree!.props.children[0];
    expect(link.props.href).toBe('/review?clientProfileId=profile_1&websiteId=site_1&type=meta_description');
    expect(link.props.children).toBe('Back to review queue');
    expect(link.props.className).toContain('min-h-11');
    expect(link.props.className).toContain('focus-visible:ring-2');
  });

  it('ignores repeated query values and defaults to the queue', async () => {
    const tree = await ActionDetailPage({ params: { actionId: 'action_1' }, searchParams: { websiteId: ['site_1', 'site_2'] } });
    expect(tree!.props.children[0].props.href).toBe('/review');
  });

  it.each(['pending', 'approved', 'edited', 'rejected'])('loads the owned receipt for %s actions', async (status) => {
    mocks.action.mockResolvedValue({ ...ownedAction, status });
    const tree = await ActionDetailPage({ params: { actionId: 'action_1' } });
    expect(mocks.receipt).toHaveBeenCalledWith(expect.objectContaining({ id: 'action_1', status }), 'owner');
    expect(tree!.props.children[1].props.receipt.basis).toBe('saved_snapshot');
  });

  it.each([
    { ...ownedAction, customerId: 'foreign' },
    { ...ownedAction, websiteId: 'other_site' },
    { ...ownedAction, website: { ...ownedAction.website, clientProfileId: 'other_profile' } },
    { ...ownedAction, website: { ...ownedAction.website, clientProfile: { id: 'profile_1', customerId: 'foreign' } } },
  ])('rejects a broken ownership chain before loading history', async (action) => {
    mocks.action.mockResolvedValue(action);
    await expect(ActionDetailPage({ params: { actionId: 'action_1' } })).rejects.toThrow('404');
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
});
