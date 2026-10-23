import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isPreferenceActive, withoutPreference } from '@/lib/preference-activation';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { action } = body as { action: 'activate' | 'deactivate' };

  if (action !== 'activate' && action !== 'deactivate') {
    return NextResponse.json({ error: 'action must be "activate" or "deactivate"' }, { status: 400 });
  }

  const candidate = await db.preferenceCandidate.findUnique({
    where: { id: params.id },
    include: {
      clientProfile: { select: { id: true, customerId: true, restrictedWording: true } },
      evaluation: true,
    },
  });

  if (!candidate || candidate.clientProfile.customerId !== customer.id || !candidate.evaluation) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if (action === 'activate' && candidate.evaluation.status !== 'passed') {
    return NextResponse.json({ error: 'This preference has not passed its quality check yet.' }, { status: 400 });
  }

  const phrase = candidate.evaluation.evaluatedPhrase;
  const currentlyActive = isPreferenceActive(candidate.clientProfile.restrictedWording, phrase);

  if (action === 'activate') {
    if (!currentlyActive) {
      // Postgres-native array push is atomic at the database level -- no read-then-write race.
      await db.clientProfile.update({
        where: { id: candidate.clientProfile.id },
        data: { restrictedWording: { push: phrase } },
      });
    }
    await db.preferenceEvaluation.update({ where: { id: candidate.evaluation.id }, data: { activatedAt: new Date() } });
  } else {
    // No atomic "remove array element" for Postgres native arrays -- this is a read-then-write.
    // Accepted risk: a low-frequency, single-actor, explicitly-clicked action, not an automated
    // high-frequency path. See the design doc's "New route" section.
    await db.clientProfile.update({
      where: { id: candidate.clientProfile.id },
      data: { restrictedWording: withoutPreference(candidate.clientProfile.restrictedWording, phrase) },
    });
    await db.preferenceEvaluation.update({ where: { id: candidate.evaluation.id }, data: { deactivatedAt: new Date() } });
  }

  return NextResponse.json({ isActive: action === 'activate' });
}
