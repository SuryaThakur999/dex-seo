import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { PATCH } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { getAdapter } from '@/lib/content-studio/registry';

vi.mock('@/lib/db', () => ({
  db: { contentPiece: { findFirst: vi.fn(), update: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/content-studio/registry', () => ({ getAdapter: vi.fn() }));

function mockAdapterValidity(valid: boolean) {
  (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue({
    platform: 'instagram',
    validate: () => ({ valid, issues: valid ? [] : ['Missing alt text.'] }),
  });
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/drafts/piece_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('PATCH /api/content-studio/drafts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await PATCH(makeRequest({ status: 'needs_review' }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the content piece is not owned by the caller', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await PATCH(makeRequest({ status: 'needs_review' }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(403);
    // The 403 above only proves the route handles a null lookup correctly — it
    // says nothing about whether the query itself actually excludes another
    // tenant's row. Assert the real where-clause shape so a future refactor
    // that silently drops the ownership scope fails this test even though the
    // mock still returns null.
    expect(db.contentPiece.findFirst).toHaveBeenCalledWith({
      where: { id: 'piece_1', clientProfile: { customer: { clerkUserId: 'user_1' } } },
    });
  });

  it('returns 400 for a disallowed status transition', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });

    const res = await PATCH(makeRequest({ status: 'published' }), { params: { id: 'piece_1' } });

    expect(res.status).toBe(400);
    expect(db.contentPiece.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the body has neither status nor draftContent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });

    const res = await PATCH(makeRequest({}), { params: { id: 'piece_1' } });

    expect(res.status).toBe(400);
  });

  it('applies an allowed status transition and stamps decidedAt', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'needs_review' });

    const res = await PATCH(makeRequest({ status: 'needs_review' }), { params: { id: 'piece_1' } });

    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: expect.objectContaining({ status: 'needs_review', decidedAt: expect.any(Date) }),
    });
    expect(res.status).toBe(200);
  });

  it('applies a draftContent edit without requiring a status change', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      status: 'draft',
      platform: 'linkedin',
    });
    mockAdapterValidity(true);
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1' });

    await PATCH(makeRequest({ draftContent: { body: 'Edited copy.' } }), { params: { id: 'piece_1' } });

    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: { draftContent: { body: 'Edited copy.' }, status: 'draft' },
    });
  });

  it('re-opens the needs_assets gate when an edit makes the content valid', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      status: 'needs_assets',
      platform: 'instagram',
    });
    mockAdapterValidity(true);
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'draft' });

    await PATCH(makeRequest({ draftContent: { caption: 'Sale', hashtags: [], altText: 'A photo of the sale rack.' } }), {
      params: { id: 'piece_1' },
    });

    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: expect.objectContaining({ status: 'draft' }),
    });
  });

  it('moves a draft piece to needs_assets when an edit makes the content invalid', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      status: 'draft',
      platform: 'instagram',
    });
    mockAdapterValidity(false);
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'needs_assets' });

    await PATCH(makeRequest({ draftContent: { caption: 'Sale', hashtags: [], altText: '' } }), {
      params: { id: 'piece_1' },
    });

    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: expect.objectContaining({ status: 'needs_assets' }),
    });
  });

  it('leaves an approved piece’s status untouched when its content is edited', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      status: 'approved',
      platform: 'instagram',
    });
    mockAdapterValidity(false);
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'approved' });

    await PATCH(makeRequest({ draftContent: { caption: 'Tweaked after approval.' } }), { params: { id: 'piece_1' } });

    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: { draftContent: { caption: 'Tweaked after approval.' } },
    });
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it('honors an explicit status transition sent alongside a draftContent edit', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      status: 'needs_assets',
      platform: 'instagram',
    });
    // Content still fails validation — the explicit transition must win anyway.
    mockAdapterValidity(false);
    (db.contentPiece.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'piece_1', status: 'needs_review' });

    const res = await PATCH(makeRequest({ status: 'needs_review', draftContent: { caption: 'Ready for a human.' } }), {
      params: { id: 'piece_1' },
    });

    expect(res.status).toBe(200);
    expect(db.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: expect.objectContaining({
        status: 'needs_review',
        draftContent: { caption: 'Ready for a human.' },
        decidedAt: expect.any(Date),
      }),
    });
  });

  it('rejects a disallowed transition sent alongside a draftContent edit without writing anything', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      status: 'draft',
      platform: 'instagram',
    });

    const res = await PATCH(makeRequest({ status: 'published', draftContent: { caption: 'Nope.' } }), {
      params: { id: 'piece_1' },
    });

    expect(res.status).toBe(400);
    expect(db.contentPiece.update).not.toHaveBeenCalled();
  });
});
