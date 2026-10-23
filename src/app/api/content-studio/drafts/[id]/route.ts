import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdapter } from '@/lib/content-studio/registry';
import type { ContentStatus } from '@prisma/client';

const ALLOWED_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['needs_review', 'archived'],
  needs_assets: ['needs_review', 'archived'],
  needs_review: ['approved', 'failed', 'archived'],
  approved: ['ready_to_publish', 'archived'],
  ready_to_publish: ['published', 'archived'],
  published: ['archived'],
  failed: ['archived'],
  archived: [],
};

// Statuses where the piece is still pre-review, so its status is purely a
// function of whether the content validates. Editing content once a human has
// approved or published it must not silently walk the piece back to `draft`.
const RECOMPUTABLE_STATUSES: ContentStatus[] = ['draft', 'needs_assets'];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const piece = await db.contentPiece.findFirst({
    where: { id: params.id, clientProfile: { customer: { clerkUserId: userId } } },
  });
  if (!piece) {
    return NextResponse.json({ error: 'Content piece not found' }, { status: 403 });
  }

  const body = await req.json();
  const data: { status?: ContentStatus; draftContent?: unknown; decidedAt?: Date } = {};

  if (typeof body.status === 'string') {
    const nextStatus = body.status as ContentStatus;
    if (!ALLOWED_TRANSITIONS[piece.status].includes(nextStatus)) {
      return NextResponse.json({ error: `Cannot move from ${piece.status} to ${nextStatus}` }, { status: 400 });
    }
    data.status = nextStatus;
    data.decidedAt = new Date();
  }
  if (body.draftContent !== undefined) {
    data.draftContent = body.draftContent;
    // Re-run the adapter so the needs_assets gate re-opens: an edit that
    // supplies the missing field moves the piece back to `draft`, and an edit
    // that removes one moves it to `needs_assets`. An explicit status
    // transition in the same request wins over this recompute.
    if (data.status === undefined && RECOMPUTABLE_STATUSES.includes(piece.status)) {
      const adapter = getAdapter(piece.platform);
      if (adapter) {
        let valid: boolean;
        try {
          valid = adapter.validate(body.draftContent as never).valid;
        } catch {
          // A hand-edited draft can be any shape; an adapter that chokes on it
          // means the content is not usable, not that the request is a 500.
          valid = false;
        }
        data.status = valid ? 'draft' : 'needs_assets';
      }
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await db.contentPiece.update({ where: { id: params.id }, data: data as never });
  return NextResponse.json(updated);
}
