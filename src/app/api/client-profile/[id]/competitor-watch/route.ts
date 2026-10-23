import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildCompetitorWatchItems, type CompetitorWatchItem } from '@/lib/competitor-watch';

export type { CompetitorWatchItem };

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
    select: { id: true, name: true },
  });
  if (competitors.length === 0) return NextResponse.json({ items: [] });

  const nameById = new Map(competitors.map((c) => [c.id, c.name]));
  const evidence = await db.evidenceItem.findMany({
    where: { entityId: { in: [...nameById.keys()] }, platform: 'competitor_site' },
    orderBy: { retrievedAt: 'desc' },
    take: 20,
  });

  const items: CompetitorWatchItem[] = buildCompetitorWatchItems(evidence, nameById);

  return NextResponse.json({ items });
}
