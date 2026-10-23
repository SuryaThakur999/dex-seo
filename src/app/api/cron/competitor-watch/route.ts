import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runCompetitorWatch } from '@/lib/research/competitor-watch-job';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // "Active" = at least one website on the profile -- a profile with none has nothing for
  // Competitor Watch's dashboard card to attach to.
  const profiles = await db.clientProfile.findMany({
    where: { websites: { some: {} } },
    select: { id: true },
  });

  let changed = 0;
  let failed = 0;
  for (const profile of profiles) {
    try {
      const result = await runCompetitorWatch(profile.id);
      changed += result.changed.length;
    } catch (err) {
      failed++;
      console.error(`competitor-watch: clientProfile ${profile.id} failed`, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ processed: profiles.length, changed, failed });
}
