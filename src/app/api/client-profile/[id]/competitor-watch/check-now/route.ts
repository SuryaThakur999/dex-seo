import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runCompetitorWatch } from '@/lib/research/competitor-watch-job';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profile = await db.clientProfile.findFirst({ where: { id: params.id, customer: { clerkUserId: userId } } });
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const result = await runCompetitorWatch(params.id);
  return NextResponse.json({ changed: result.changed.length });
}
