import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { generateFeedbackSummary } from '@/lib/feedback-analysis';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findMany: vi.fn() },
    auditLogEntry: { findMany: vi.fn() },
    feedbackAnalysis: { upsert: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
}));

vi.mock('@/lib/feedback-analysis', async () => {
  const actual = await vi.importActual<typeof import('@/lib/feedback-analysis')>('@/lib/feedback-analysis');
  return { ...actual, generateFeedbackSummary: vi.fn() };
});

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/websites/w1/feedback-analysis', { method: 'POST' }) as unknown as NextRequest;
}

function editedAction(id: string, daysAgo: number) {
  return { id, actionType: 'meta_description', status: 'edited', draftContent: `New ${id}` };
}

function editedEntry(id: string, actionId: string, daysAgo: number) {
  return {
    id,
    actionId,
    detail: { decision: 'edited', originalDraftContent: `Old ${actionId}` },
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

describe('POST /api/websites/[id]/feedback-analysis', () => {
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

  it('reports belowThreshold without calling the model when there are fewer than 5 eligible edits', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1' } });
    const actions = [editedAction('a1', 1), editedAction('a2', 2)];
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      editedEntry('e1', 'a1', 1),
      editedEntry('e2', 'a2', 2),
    ]);

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.belowThreshold).toBe(true);
    expect(body.needed).toBe(3);
    expect(generateFeedbackSummary).not.toHaveBeenCalled();
    expect(db.feedbackAnalysis.upsert).not.toHaveBeenCalled();
  });

  it('generates and upserts a summary when at least 5 eligible edits exist', async () => {
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1' } });
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const actions = ids.map((id, i) => editedAction(id, i));
    const entries = ids.map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (generateFeedbackSummary as ReturnType<typeof vi.fn>).mockResolvedValue('Real pattern summary.');
    (db.feedbackAnalysis.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.belowThreshold).toBe(false);
    expect(body.summary).toBe('Real pattern summary.');
    expect(body.sourceEditCount).toBe(5);
    expect(db.feedbackAnalysis.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = (db.feedbackAnalysis.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ websiteId: 'w1' });
    expect(upsertArgs.create.summary).toBe('Real pattern summary.');
    expect(upsertArgs.create.sourceEditCount).toBe(5);
    expect(upsertArgs.create.modelVersion).toBeTruthy();
    expect(upsertArgs.create.promptVersion).toBeTruthy();
  });

  it('sets generatedAt on the upsert update branch, matching the response value (Finding 1 regression)', async () => {
    // The Prisma `generatedAt` field is `@default(now())`, which only applies on insert -- a
    // re-analysis (an existing row hitting the `update` branch of the upsert) must set it
    // explicitly, or the persisted row keeps the original creation timestamp forever and the
    // next page load shows a stale "generated" date even though this response is correct.
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ website: { id: 'w1' } });
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const actions = ids.map((id, i) => editedAction(id, i));
    const entries = ids.map((id, i) => editedEntry(`e-${id}`, id, i));
    (db.action.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(actions);
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(entries);
    (generateFeedbackSummary as ReturnType<typeof vi.fn>).mockResolvedValue('Real pattern summary.');
    (db.feedbackAnalysis.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const before = Date.now();
    const res = await POST(makeRequest(), { params: { id: 'w1' } });
    const after = Date.now();
    const body = await res.json();

    const upsertArgs = (db.feedbackAnalysis.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertArgs.update.generatedAt).toBeInstanceOf(Date);
    expect(upsertArgs.update.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(upsertArgs.update.generatedAt.getTime()).toBeLessThanOrEqual(after);
    // create and update must agree, and both must equal what the response reports back.
    expect(upsertArgs.create.generatedAt).toEqual(upsertArgs.update.generatedAt);
    expect(body.generatedAt).toBe(upsertArgs.update.generatedAt.toISOString());
  });
});
