import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    preferenceCandidate: { findUnique: vi.fn() },
    clientProfile: { update: vi.fn() },
    preferenceEvaluation: { update: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

function makeRequest(body: object): NextRequest {
  return new Request('http://localhost:3000/api/preference-candidates/cand1/activation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function candidate(overrides: Partial<{
  id: string;
  clientProfileId: string;
  customerId: string;
  restrictedWording: string[];
  evaluation: { id: string; status: string; evaluatedPhrase: string } | null;
}> = {}) {
  return {
    id: 'cand1',
    clientProfileId: 'cp1',
    clientProfile: { id: 'cp1', customerId: overrides.customerId ?? 'cust1', restrictedWording: overrides.restrictedWording ?? [] },
    evaluation: overrides.evaluation === undefined ? { id: 'ev1', status: 'passed', evaluatedPhrase: 'industry-leading' } : overrides.evaluation,
  };
}

describe('POST /api/preference-candidates/[id]/activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid action value', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(candidate());

    const res = await POST(makeRequest({ action: 'not-a-real-action' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the candidate belongs to a different customer', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(candidate({ customerId: 'someone-else' }));

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(404);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the candidate has no evaluation yet', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(candidate({ evaluation: null }));

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(404);
  });

  it('returns 400 when activating an evaluation that has not passed', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ evaluation: { id: 'ev1', status: 'evaluating', evaluatedPhrase: 'industry-leading' } })
    );

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('activates a passed evaluation by pushing the phrase', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['best-in-class'] })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(true);
    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp1' },
      data: { restrictedWording: { push: 'industry-leading' } },
    });
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { activatedAt: expect.any(Date) },
    });
  });

  it('does not push a duplicate when the phrase is already active', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['industry-leading'] })
    );
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'activate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(true);
    expect(db.clientProfile.update).not.toHaveBeenCalled();
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { activatedAt: expect.any(Date) },
    });
  });

  it('deactivates by removing the phrase', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['industry-leading', 'best-in-class'] })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'deactivate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(false);
    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp1' },
      data: { restrictedWording: ['best-in-class'] },
    });
    expect(db.preferenceEvaluation.update).toHaveBeenCalledWith({
      where: { id: 'ev1' },
      data: { deactivatedAt: expect.any(Date) },
    });
  });

  it('deactivating an already-inactive phrase is a no-op write but still succeeds', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({ restrictedWording: ['best-in-class'] })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'deactivate' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isActive).toBe(false);
    expect(db.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'cp1' },
      data: { restrictedWording: ['best-in-class'] },
    });
  });

  it('deactivating is allowed even when the evaluation status is not passed', async () => {
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      candidate({
        restrictedWording: ['industry-leading'],
        evaluation: { id: 'ev1', status: 'passed', evaluatedPhrase: 'industry-leading' },
      })
    );
    (db.clientProfile.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.preferenceEvaluation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest({ action: 'deactivate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(200);
  });
});
