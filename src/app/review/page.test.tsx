import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
const mocks = vi.hoisted(() => ({ receipt: vi.fn(), load: vi.fn(), action: vi.fn(), detail: vi.fn(), candidates: vi.fn(), customer: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/load-proof-receipt', () => ({ loadProofReceipt: mocks.receipt }));
vi.mock('@clerk/nextjs/server', () => ({ auth: () => ({ userId: 'clerk_owner' }) }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/lib/decision-inbox', () => ({ loadDecisionInbox: mocks.load }));
vi.mock('@/lib/db', () => ({ db: { customer: { findUnique: mocks.customer }, website: { findMany: async () => [] }, action: { findMany: mocks.action, findFirst: mocks.detail, groupBy: async () => [] }, preferenceCandidate: { findMany: mocks.candidates, findFirst: async () => null } } }));
import ReviewPage from './page';
const row = { key: 'content:c1', id: 'c1', kind: 'content', clientProfileId: 'cp_2', websiteId: null, scopeLabel: 'Client-wide; no website link', title: 'Review content', createdAt: '2026-10-04T00:00:00Z', state: 'needs_decision', href: null, unavailableReason: 'Direct client navigation is unavailable' };
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.resetAllMocks();
  mocks.notFound.mockImplementation(() => { throw new Error('404'); });
  mocks.customer.mockResolvedValue({ id: 'owner' });
  mocks.load.mockResolvedValue({ rows: [row], truncated: false, truncatedSections: [] });
  mocks.action.mockResolvedValue([]);
  mocks.detail.mockResolvedValue(null);
  mocks.candidates.mockResolvedValue([]);
});
describe('Review page', () => {
  it('keeps content visible with no pending actions and counts only loaded entries', async () => {
    const tree = JSON.stringify(await ReviewPage({ searchParams: {} }));
    expect(tree).toContain('Review content');
    expect(tree).toContain('Client-wide; no website link');
    expect(tree).toContain('loaded');
    expect(tree).not.toContain('Nothing to review right now');
  });
  it('passes explicit scope to the read model without widening', async () => {
    await ReviewPage({ searchParams: { clientProfileId: 'cp_2', websiteId: 'site_2' } });
    expect(mocks.load).toHaveBeenCalledWith({ customerId: 'owner', clientProfileId: 'cp_2', websiteId: 'site_2' });
  });
  it('returns notFound for an invalid explicit scope', async () => {
    mocks.load.mockRejectedValue({ status: 404 });
    await expect(ReviewPage({ searchParams: { websiteId: 'foreign' } })).rejects.toThrow('404');
  });
  it('shows the loading limit without a total-count claim', async () => {
    mocks.load.mockResolvedValue({ rows: [row], truncated: true, truncatedSections: ['content needs_review'] });
    const tree = JSON.stringify(await ReviewPage({ searchParams: {} }));
    expect(tree).toContain('Showing first 100');
    expect(tree).toContain('content needs_review');
    expect(tree).not.toContain('total');
  });
  it('independently loads an owned deep-linked action even outside the bounded queue', async () => {
    mocks.detail.mockResolvedValue({ id: 'older_owned', customerId: 'owner', websiteId: 'site_2', website: { clientProfile: { id: 'cp_2', customerId: 'owner' } }, createdAt: new Date(), decidedAt: null, guardResult: null });
    await ReviewPage({ searchParams: { actionId: 'older_owned', clientProfileId: 'cp_2', websiteId: 'site_2' } });
    expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'older_owned', customerId: 'owner', websiteId: 'site_2', website: { clientProfileId: 'cp_2', clientProfile: { customerId: 'owner' } } }) }));
    expect(mocks.receipt).toHaveBeenCalledWith(expect.objectContaining({ id: 'older_owned' }), 'owner');
  });
  it('renders proposed preferences without scheduling generation on page load', async () => {
    mocks.load.mockResolvedValue({ rows: [{ ...row, kind: 'preference', id: 'p1' }], truncated: false });
    mocks.candidates.mockResolvedValue([{ id: 'p1', clientProfileId: 'cp_2', websiteId: 's2', website: { clientProfileId: 'cp_2', url: 'https://two.test' }, clientProfile: { name: 'Client Two', restrictedWording: [] }, status: 'proposed', originalProposedPhrase: 'Phrase', rationale: 'Observed edits', evidenceExcerpts: [], evaluation: null }]);
    const tree = JSON.stringify(await ReviewPage({ searchParams: {} }));
    expect(tree).toContain('whole client profile');
    expect(tree).toContain('"checkWebsiteIds":[]');
  });

  it('does not render an action-kind row in the inbox sections when it is already shown in Site changes (dashboard audit item 11)', async () => {
    const actionRow = { ...row, key: 'action:a1', id: 'a1', kind: 'action', title: 'Fix missing canonical', state: 'needs_decision' };
    mocks.load.mockResolvedValue({ rows: [actionRow], truncated: false });
    mocks.action.mockResolvedValue([{
      id: 'a1', customerId: 'owner', websiteId: 'site_1', actionType: 'canonical_fix', status: 'pending',
      pageUrl: 'https://example.com/pricing', draftContent: '<link rel="canonical">', currentValue: null,
      riskTier: 'low', generationStatus: 'succeeded', generationError: null, createdAt: new Date(), decidedAt: null,
      outcomeMeasuredAt: null, policyVersion: 'v1', aiDisclosure: 'ai', revision: 'rev_1',
      guardResult: { outcome: 'pass', reasoning: 'ok', checksRun: [{ check: 'c', detail: 'd', result: 'pass' }] },
      website: { clientProfile: { id: 'cp_2', customerId: 'owner' } },
    }]);

    const tree = JSON.stringify(await ReviewPage({ searchParams: {} }));
    // The inbox-section generic link text ("Fix missing canonical" as a plain <Link>/<p> title)
    // should not appear -- only the richer Site changes review UI renders this action.
    expect(tree).not.toContain('Fix missing canonical');
    expect(tree).toContain('Site changes');
  });

  it('reworded header counts only states actually awaiting a decision, not every loaded entry', async () => {
    const readyRow = { ...row, key: 'content:ready', id: 'ready', state: 'ready_to_apply' };
    mocks.load.mockResolvedValue({ rows: [row, readyRow], truncated: false });

    const tree = JSON.stringify(await ReviewPage({ searchParams: {} }));
    // Rendered as [1, " changes waiting..."] (JSX splits the number from the string child).
    expect(tree).toContain('[1," changes waiting for your decision');
    expect(tree).not.toContain('loaded inbox entries');
  });
});
