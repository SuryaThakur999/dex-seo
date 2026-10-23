import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { proposeCandidate } from '@/lib/preference-candidates';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findMany: vi.fn() },
    auditLogEntry: { findMany: vi.fn() },
    clientProfile: { findUnique: vi.fn() },
    preferenceCandidate: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    preferenceCandidateCheck: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/preference-candidates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preference-candidates')>('@/lib/preference-candidates');
  return { ...actual, proposeCandidate: vi.fn() };
});

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/websites/w1/preference-candidates/check', { method: 'POST' }) as unknown as NextRequest;
}

function editedAction(id: string) {
  return { id, actionType: 'meta_description', status: 'edited', draftContent: 'Our solution helps you grow.' };
}

function editedEntry(id: string, actionId: string, daysAgo: number) {
  return {
    id,
    actionId,
    detail: { decision: 'edited', originalDraftContent: 'Our industry-leading solution helps you grow.' },
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

describe('POST /api/websites/[id]/preference-candidates/check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest(), { params: { id: 'w1' } });

    expect(res.status).toBe(401);
  });

  it('returns 404 when the website does not belong to this customer', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new WebsiteNotFoundError('not found'));

    const res = await POST(makeRequest(), { params: { id: 'someone-elses' } });

    expect(res.status).toBe(404);
    expect(db.action.findMany).not.toHaveBeenCalled();
  });

  it('returns below_threshold without calling the model when fewer than 5 eligible edits exist', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([editedAction('a1')]);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([editedEntry('e1', 'a1', 1)]);

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('below_threshold');
    expect(proposeCandidate).not.toHaveBeenCalled();
  });

  it('returns the stored outcome without a new LLM call when the fingerprint is unchanged (loses updateMany, loses create with P2002)', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const actions = ['a1', 'a2', 'a3', 'a4', 'a5'].map(editedAction);
    const entries = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);

    // Fingerprint unchanged: the updateMany's `lastFingerprint: { not: fingerprint }` filter
    // matches 0 rows (the stored one already equals the live one), and the create attempt then
    // collides with the existing row (P2002) -- losing the claim correctly returns the stored
    // outcome without ever calling the model.
    (db.preferenceCandidateCheck.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const { Prisma } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
    (db.preferenceCandidateCheck.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    );
    (db.preferenceCandidateCheck.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ lastOutcome: 'no_pattern' });

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('no_pattern');
    expect(proposeCandidate).not.toHaveBeenCalled();
  });

  it('loses the claim gracefully when another request already claimed this exact fingerprint (P2002 on create, first-ever check)', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const actions = ['a1', 'a2', 'a3', 'a4', 'a5'].map(editedAction);
    const entries = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (db.preferenceCandidateCheck.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    const { Prisma } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
    (db.preferenceCandidateCheck.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    );
    (db.preferenceCandidateCheck.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ lastOutcome: 'candidate_created' });

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('candidate_created');
    expect(proposeCandidate).not.toHaveBeenCalled();
  });

  it('wins the claim via updateMany when a row already exists with a different fingerprint', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const actions = ids.map(editedAction);
    const entries = ids.map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (db.preferenceCandidateCheck.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [] });
    (db.preferenceCandidate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (proposeCandidate as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.preferenceCandidateCheck.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('no_pattern');
    expect(db.preferenceCandidateCheck.create).not.toHaveBeenCalled();
    expect(db.preferenceCandidateCheck.update).toHaveBeenCalledTimes(1);
  });

  it('creates a candidate when the LLM proposal passes the verification gate (first-ever check, wins via create)', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1', clientProfileId: 'cp1' } });
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const actions = ids.map(editedAction);
    const entries = ids.map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (db.preferenceCandidateCheck.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (db.preferenceCandidateCheck.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.clientProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ restrictedWording: [] });
    (db.preferenceCandidate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (proposeCandidate as ReturnType<typeof vi.fn>).mockResolvedValue({ phrase: 'industry-leading', rationale: 'Removed repeatedly.' });
    (db.preferenceCandidate.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cand1', originalProposedPhrase: 'industry-leading', rationale: 'Removed repeatedly.', evidenceExcerpts: [] });
    (db.preferenceCandidateCheck.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.outcome).toBe('candidate_created');
    expect(body.candidate.originalProposedPhrase).toBe('industry-leading');
    expect(db.preferenceCandidate.create).toHaveBeenCalledTimes(1);
    expect(db.preferenceCandidateCheck.update).toHaveBeenCalledTimes(1);
  });
});
