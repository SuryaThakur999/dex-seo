import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    preferenceCandidate: { findUnique: vi.fn(), update: vi.fn() },
    preferenceEvaluation: { create: vi.fn() },
    auditLogEntry: { findMany: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

function makeRequest(body: object): NextRequest {
  return new Request('http://localhost:3000/api/preference-candidates/cand1/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/preference-candidates/[id]/decide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest({ decision: 'evaluate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the candidate belongs to a different customer', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'proposed',
      clientProfile: { customerId: 'someone-elses-customer' },
    });

    const res = await POST(makeRequest({ decision: 'evaluate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(404);
    expect(db.preferenceCandidate.update).not.toHaveBeenCalled();
  });

  it('returns 400 for an already-decided candidate', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'rejected',
      clientProfile: { customerId: 'cust1' },
    });

    const res = await POST(makeRequest({ decision: 'evaluate' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid decision value', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });

    const res = await POST(makeRequest({ decision: 'invalid' }), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
    expect(db.preferenceCandidate.update).not.toHaveBeenCalled();
  });

  it('returns 400 for missing decision value', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });

    const res = await POST(makeRequest({}), { params: { id: 'cand1' } });

    expect(res.status).toBe(400);
    expect(db.preferenceCandidate.update).not.toHaveBeenCalled();
  });

  it('sets approved_for_evaluation and never touches ClientProfile', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'proposed',
      clientProfileId: 'cp1',
      websiteId: 'web1',
      targetField: 'metaDescription',
      originalProposedPhrase: 'industry-leading',
      evidenceEntryIds: ['e1', 'e2'],
      sourceFingerprint: 'fp1',
      clientProfile: { customerId: 'cust1' },
    });
    (db.preferenceCandidate.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cand1', status: 'approved_for_evaluation' });
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { actionId: 'act1' },
      { actionId: 'act2' },
    ]);

    const res = await POST(makeRequest({ decision: 'evaluate', editedPhrase: 'best-in-class' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('approved_for_evaluation');
    expect(db.preferenceCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand1' },
      data: { status: 'approved_for_evaluation', customerEditedPhrase: 'best-in-class', decidedAt: expect.any(Date) },
    });
    expect(db.auditLogEntry.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1', 'e2'] } },
      select: { actionId: true },
    });
    expect(db.preferenceEvaluation.create).toHaveBeenCalledWith({
      data: {
        candidateId: 'cand1',
        clientProfileId: 'cp1',
        websiteId: 'web1',
        targetField: 'metaDescription',
        evaluatedPhrase: 'best-in-class',
        excludedActionIds: ['act1', 'act2'],
        status: 'pending',
        evaluatorVersion: 'v1',
        sourceFingerprint: 'fp1',
      },
    });
  });

  it('translates evidenceEntryIds (AuditLogEntry.id) to their Action.id, filtering out any null actionId', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'proposed',
      clientProfileId: 'cp1',
      websiteId: 'web1',
      targetField: 'metaDescription',
      originalProposedPhrase: 'industry-leading',
      evidenceEntryIds: ['e1', 'e2', 'e3'],
      sourceFingerprint: 'fp1',
      clientProfile: { customerId: 'cust1' },
    });
    (db.preferenceCandidate.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cand1', status: 'approved_for_evaluation' });
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { actionId: 'act1' },
      { actionId: null },
      { actionId: 'act2' },
    ]);

    await POST(makeRequest({ decision: 'evaluate' }), { params: { id: 'cand1' } });

    const createCall = (db.preferenceEvaluation.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.excludedActionIds).toEqual(['act1', 'act2']);
  });

  it('sets rejected with no editedPhrase change', async () => {
    (db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust1' });
    (db.preferenceCandidate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cand1',
      status: 'proposed',
      clientProfile: { customerId: 'cust1' },
    });
    (db.preferenceCandidate.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cand1', status: 'rejected' });

    const res = await POST(makeRequest({ decision: 'reject' }), { params: { id: 'cand1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('rejected');
    expect(db.preferenceCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand1' },
      data: { status: 'rejected', customerEditedPhrase: undefined, decidedAt: expect.any(Date) },
    });
    expect(db.preferenceEvaluation.create).not.toHaveBeenCalled();
  });
});
