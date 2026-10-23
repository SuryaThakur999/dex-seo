import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { formatContentExport } from '@/lib/content-studio/export-formatter';

vi.mock('@/lib/db', () => ({
  db: { contentPiece: { findFirst: vi.fn() } },
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

vi.mock('@/lib/content-studio/export-formatter', () => ({ formatContentExport: vi.fn() }));

function makeRequest(): NextRequest {
  return new Request('http://localhost:3000/api/content-studio/drafts/piece_1/export') as unknown as NextRequest;
}

describe('GET /api/content-studio/drafts/[id]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await GET(makeRequest(), { params: { id: 'piece_1' } });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the content piece is not owned by the caller', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: { id: 'piece_1' } });

    expect(res.status).toBe(403);
    // Assert the real where-clause, not just the mocked null response — a
    // dropped ownership scope would still 403 here if the mock weren't checked.
    expect(db.contentPiece.findFirst).toHaveBeenCalledWith({
      where: { id: 'piece_1', clientProfile: { customer: { clerkUserId: 'user_1' } } },
    });
  });

  it('returns 409 for a failed piece rather than formatting its empty draftContent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      platform: 'linkedin',
      status: 'failed',
      draftContent: {},
    });

    const res = await GET(makeRequest(), { params: { id: 'piece_1' } });

    expect(res.status).toBe(409);
    expect(formatContentExport).not.toHaveBeenCalled();
  });

  it('returns the formatted export as plain text', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (db.contentPiece.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'piece_1',
      platform: 'linkedin',
      status: 'draft',
      draftContent: { body: 'A fine post.', hashtags: ['sale'] },
    });
    (formatContentExport as ReturnType<typeof vi.fn>).mockReturnValue('A fine post.\n\n#sale');

    const res = await GET(makeRequest(), { params: { id: 'piece_1' } });
    const text = await res.text();

    expect(formatContentExport).toHaveBeenCalledWith('linkedin', { body: 'A fine post.', hashtags: ['sale'] });
    expect(text).toBe('A fine post.\n\n#sale');
    expect(res.headers.get('Content-Type')).toContain('text/plain');
  });
});
