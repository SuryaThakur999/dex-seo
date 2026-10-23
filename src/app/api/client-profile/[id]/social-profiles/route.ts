import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { validateSocialProfiles } from '@/lib/profile-suggestion-evidence';

// Manual owner add/remove (social-profile-discovery plan, 2026-10-17): bypasses the
// ProfileSuggestion accept/reject gate entirely -- same "direct PATCH, whole list replaced"
// pattern markets/languages already use via /api/client-profile/[id], not the suggestion flow
// scan-discovered links go through (see run-scan.ts).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profile = await db.clientProfile.findFirst({ where: { id: params.id, customer: { clerkUserId: userId } } });
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const body = await req.json();
  let socialProfiles;
  try {
    socialProfiles = validateSocialProfiles(body?.socialProfiles, { allowEmpty: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid socialProfiles' }, { status: 400 });
  }

  const updated = await db.clientProfile.update({ where: { id: params.id }, data: { socialProfiles: socialProfiles as unknown as Prisma.InputJsonValue } });
  return NextResponse.json({ socialProfiles: updated.socialProfiles });
}
