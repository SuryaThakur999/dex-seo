import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { fetchPageMeta } from '@/lib/crawler';
import { CUSTOMER_SAFE_GENERATION_ERROR } from '@/lib/customer-safe-error';
import { enqueueGenerationJob, claimAndRunGenerationJob } from '@/lib/generation-worker';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { findUnique: vi.fn(), updateMany: vi.fn() },
    website: { findUnique: vi.fn() },
    clientProfile: { findUnique: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('@/lib/crawler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crawler')>();
  return { ...actual, fetchPageMeta: vi.fn(), fetchHtml: vi.fn() };
});
// Phase 1C: this route now enqueues+immediately runs a GenerationJob instead of calling a
// generator inline -- see generation-worker.ts. Mocking it here keeps this file scoped to the
// route's own job (dispatch by actionType, re-fetch fresh page state, react to the outcome),
// while the actual generate+guard+write pipeline is covered by generation-worker.test.ts and
// this route's dispatch-target unit tests (restricted-wording-fix.test.ts etc).
vi.mock('@/lib/generation-worker', () => ({
  enqueueGenerationJob: vi.fn(async () => ({ id: 'genjob_1' })),
  claimAndRunGenerationJob: vi.fn(async () => ({ processed: true, outcome: 'completed' })),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/actions/action_1/retry-draft', { method: 'POST' }) as unknown as NextRequest;
}

const CUSTOMER = { id: 'cust_1', clerkUserId: 'user_1' };
const FAILED_ACTION = {
  id: 'action_1',
  customerId: 'cust_1',
  websiteId: 'website_1',
  pageUrl: 'https://example.com/page',
  status: 'pending',
  generationStatus: 'failed',
};
const WEBSITE = { id: 'website_1', clientProfileId: 'profile_1', autoExecuteEnabled: false };

describe('POST /api/actions/[actionId]/retry-draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the action belongs to a different customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FAILED_ACTION, customerId: 'someone_else' });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
  });

  it('rejects retrying an action whose draft already succeeded', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FAILED_ACTION, generationStatus: 'succeeded' });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('This finding is not retriable');
    expect(enqueueGenerationJob).not.toHaveBeenCalled();
  });

  it('succeeds: fetches fresh page meta and enqueues+runs a meta_description job', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(FAILED_ACTION);
    (db.website.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(WEBSITE);
    (fetchPageMeta as ReturnType<typeof vi.fn>).mockResolvedValue({ title: 'Title', h1: 'H1', metaDescription: 'Old meta' });

    const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(fetchPageMeta).toHaveBeenCalledWith('https://example.com/page');
    expect(enqueueGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust_1',
        websiteId: 'website_1',
        actionType: 'meta_description',
        targetRef: 'https://example.com/page',
        payload: { actionType: 'meta_description', url: 'https://example.com/page', title: 'Title', metaDescription: 'Old meta', h1: 'H1', findingId: null },
      })
    );
    expect(claimAndRunGenerationJob).toHaveBeenCalledWith('genjob_1');
    expect(res.status).toBe(303); // redirect
  });

  it('writes a "still working" message without touching generationStatus when the job is still retrying in the background', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(FAILED_ACTION);
    (db.website.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(WEBSITE);
    (fetchPageMeta as ReturnType<typeof vi.fn>).mockResolvedValue({ title: 'Title', h1: 'H1', metaDescription: 'Old meta' });
    (claimAndRunGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true, outcome: 'waiting_retry' });

    await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(db.action.updateMany).toHaveBeenCalledWith({
      where: { id: 'action_1', generationStatus: 'failed' },
      data: { generationError: expect.stringMatching(/check back/i) },
    });
  });

  it('records a customer-safe error when the retry throws before ever reaching the queue (page unreadable)', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(FAILED_ACTION);
    (db.website.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(WEBSITE);
    (fetchPageMeta as ReturnType<typeof vi.fn>).mockResolvedValue({ title: null, h1: null, metaDescription: null });

    await POST(makeRequest(), { params: { actionId: 'action_1' } });

    expect(enqueueGenerationJob).not.toHaveBeenCalled();
    expect(db.action.updateMany).toHaveBeenCalledWith({
      where: { id: 'action_1', generationStatus: 'failed' },
      data: { generationError: CUSTOMER_SAFE_GENERATION_ERROR },
    });
  });

  describe('restricted_wording_fix actionType', () => {
    const RWF_ACTION = { ...FAILED_ACTION, actionType: 'restricted_wording_fix' };
    const PAGE_HTML = '<html><body>We offer guaranteed results for everyone.</body></html>';

    it('re-checks the page fresh and enqueues+runs a restricted_wording_fix job with the current matches', async () => {
      const { fetchHtml } = await import('@/lib/crawler');
      (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
      (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
      (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(RWF_ACTION);
      (db.website.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(WEBSITE);
      (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: ['guaranteed results'] });
      (fetchHtml as ReturnType<typeof vi.fn>).mockResolvedValue(PAGE_HTML);

      const res = await POST(makeRequest(), { params: { actionId: 'action_1' } });

      expect(fetchHtml).toHaveBeenCalledWith('https://example.com/page');
      expect(enqueueGenerationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'restricted_wording_fix',
          targetRef: 'https://example.com/page',
          payload: expect.objectContaining({
            actionType: 'restricted_wording_fix',
            matches: [expect.objectContaining({ phrase: 'guaranteed results' })],
          }),
        })
      );
      expect(claimAndRunGenerationJob).toHaveBeenCalledWith('genjob_1');
      expect(res.status).toBe(303);
    });

    it('fails honestly (no job enqueued, no fabricated content) when the restricted wording is no longer on the page', async () => {
      const { fetchHtml } = await import('@/lib/crawler');
      (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
      (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
      (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(RWF_ACTION);
      (db.website.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(WEBSITE);
      (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: ['guaranteed results'] });
      (fetchHtml as ReturnType<typeof vi.fn>).mockResolvedValue('<html><body>Nothing restricted here.</body></html>');

      await POST(makeRequest(), { params: { actionId: 'action_1' } });

      expect(enqueueGenerationJob).not.toHaveBeenCalled();
      expect(db.action.updateMany).toHaveBeenCalledWith({
        where: { id: 'action_1', generationStatus: 'failed' },
        data: { generationError: CUSTOMER_SAFE_GENERATION_ERROR },
      });
    });
  });

  describe('internal_link_fix actionType', () => {
    it('explicitly rejects retry rather than falling through to another generator and corrupting the row', async () => {
      const ILF_ACTION = { ...FAILED_ACTION, actionType: 'internal_link_fix' };
      (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
      (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
      (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(ILF_ACTION);
      (db.website.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(WEBSITE);

      await POST(makeRequest(), { params: { actionId: 'action_1' } });

      expect(enqueueGenerationJob).not.toHaveBeenCalled();
      expect(db.action.updateMany).toHaveBeenCalledWith({
        where: { id: 'action_1', generationStatus: 'failed' },
        data: { generationError: CUSTOMER_SAFE_GENERATION_ERROR },
      });
    });
  });
});
