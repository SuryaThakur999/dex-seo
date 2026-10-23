import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { formatContentExport } from '@/lib/content-studio/export-formatter';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const piece = await db.contentPiece.findFirst({
    where: { id: params.id, clientProfile: { customer: { clerkUserId: userId } } },
  });
  if (!piece) {
    return NextResponse.json({ error: 'Content piece not found' }, { status: 403 });
  }

  // A failed piece stores `draftContent: {}` — there is nothing to export, and
  // this URL is a plain GET the owner can hit directly whatever the UI shows.
  if (piece.status === 'failed') {
    return NextResponse.json(
      { error: 'This draft failed to generate and has no content to export.' },
      { status: 409 }
    );
  }

  const text = formatContentExport(piece.platform, piece.draftContent);
  return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
