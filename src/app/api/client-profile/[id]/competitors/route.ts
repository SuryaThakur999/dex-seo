import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classifyCompetitor } from '@/lib/research/competitor-resolver';

async function requireOwnedProfile(userId: string, profileId: string) {
  return db.clientProfile.findFirst({ where: { id: profileId, customer: { clerkUserId: userId } } });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profile = await requireOwnedProfile(userId, params.id);
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const competitors = await db.competitorEntity.findMany({
    where: { clientProfileId: params.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return NextResponse.json({ competitors });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profile = await requireOwnedProfile(userId, params.id);
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const body = await req.json();
  if (typeof body?.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }
  const name: string = body.name.trim();
  const canonicalDomain: string | null = typeof body.canonicalDomain === 'string' && body.canonicalDomain.trim()
    ? body.canonicalDomain.trim() : null;

  const existing = canonicalDomain
    ? await db.competitorEntity.findFirst({ where: { clientProfileId: params.id, canonicalDomain } })
    : null;
  const { classification, reason } = classifyCompetitor(
    { name, canonicalDomain },
    existing ? { name: existing.name, canonicalDomain: existing.canonicalDomain } : undefined,
  );

  const competitor = await db.competitorEntity.create({
    data: {
      clientProfileId: params.id, name, canonicalDomain,
      classification, classificationReason: reason,
      source: 'user_added', userConfirmed: true,
    },
  });
  return NextResponse.json({ competitor }, { status: 201 });
}
