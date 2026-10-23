import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { GamePreference } from '@prisma/client';

const VALID_PREFERENCES = new Set<GamePreference>(['ask', 'always_game', 'always_watch', 'disabled']);

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const { gamePreference } = body;
  if (typeof gamePreference !== 'string' || !VALID_PREFERENCES.has(gamePreference as GamePreference)) {
    return NextResponse.json({ error: 'Invalid gamePreference value' }, { status: 400 });
  }

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  await db.customer.update({
    where: { id: customer.id },
    data: { gamePreference: gamePreference as GamePreference },
  });

  return NextResponse.json({ ok: true });
}
