import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { renderEvidencePdf } from '@/lib/evidence-pdf';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    action: { findUnique: vi.fn() },
    auditLogEntry: { findMany: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/evidence-pdf', () => ({
  renderEvidencePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake-content')),
}));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/actions/action_1/evidence') as unknown as NextRequest;
}

const CUSTOMER = { id: 'cust_1', clerkUserId: 'user_1' };
const WEBSITE = { id: 'website_1', clientProfileId: 'profile_1', clientProfile: { id: 'profile_1', customerId: 'cust_1' } };

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action_1',
    customerId: 'cust_1',
    websiteId: 'website_1',
    website: WEBSITE,
    status: 'approved',
    pageUrl: 'https://example.com/a',
    actionType: 'meta_description',
    decidedAt: new Date('2026-01-01'),
    currentValue: 'Old text.',
    draftContent: 'New text.',
    riskTier: 'low',
    policyVersion: 'policy_1',
    baselinePerformance: null,
    outcomePerformance: null,
    baselineCapturedAt: null,
    outcomeMeasuredAt: null,
    guardResult: { outcome: 'pass', reasoning: 'ok', checksRun: [] },
    ...overrides,
  };
}

describe('GET /api/actions/[actionId]/evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the action belongs to a different customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAction({ customerId: 'someone_elses_customer_id' })
    );

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
  });

  it('returns 404 when the website/clientProfile chain does not resolve to this customer', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAction({ website: { ...WEBSITE, clientProfile: { id: 'profile_1', customerId: 'someone_else' } } })
    );

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(404);
  });

  it('returns 400 for a pending action', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAction({ status: 'pending' }));

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(400);
    expect(renderEvidencePdf).not.toHaveBeenCalled();
  });

  it('returns 400 for a rejected action', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAction({ status: 'rejected' }));

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(400);
  });

  it('returns a PDF with the correct headers for an approved action', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(CUSTOMER);
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeAction());

    const res = await GET(makeRequest(), { params: { actionId: 'action_1' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="dex-evidence-action_1.pdf"');
    expect(renderEvidencePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'approved',
        receipt: expect.objectContaining({
          actionId: 'action_1',
          currentRecord: expect.objectContaining({ pageUrl: 'https://example.com/a', draftContent: 'New text.' }),
        }),
      })
    );
    const bodyBytes = await res.arrayBuffer();
    expect(Buffer.from(bodyBytes).toString()).toBe('%PDF-fake-content');
  });
});
