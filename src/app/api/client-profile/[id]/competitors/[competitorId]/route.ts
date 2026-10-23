import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const VALID_CLASSIFICATIONS = new Set(['direct', 'indirect', 'adjacent', 'unknown']);

async function requireOwnedCompetitor(userId: string, profileId: string, competitorId: string) {
  const profile = await db.clientProfile.findFirst({ where: { id: profileId, customer: { clerkUserId: userId } } });
  if (!profile) return null;
  return db.competitorEntity.findFirst({ where: { id: competitorId, clientProfileId: profileId } });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; competitorId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const existing = await requireOwnedCompetitor(userId, params.id, params.competitorId);
  if (!existing) return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body?.classification !== 'string' || !VALID_CLASSIFICATIONS.has(body.classification)) {
    return NextResponse.json({ error: 'classification must be one of direct/indirect/adjacent/unknown.' }, { status: 400 });
  }

  const competitor = await db.competitorEntity.update({
    where: { id: params.competitorId },
    data: { classification: body.classification, classificationReason: 'Manually corrected by user.', userConfirmed: true },
  });
  return NextResponse.json({ competitor });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; competitorId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const existing = await requireOwnedCompetitor(userId, params.id, params.competitorId);
  if (!existing) return NextResponse.json({ error: 'Competitor not found' }, { status: 404 });

  await db.competitorEntity.delete({ where: { id: params.competitorId } });
  return new NextResponse(null, { status: 204 });
}
