import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ActionDecisionError, decideAction } from '@/lib/action-decision';

export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });
  const form = await req.formData().catch(() => null);
  const draftContent = form?.get('draftContent');
  if (typeof draftContent !== 'string' || !draftContent.trim()) {
    return NextResponse.json({ error: 'Edited content cannot be empty' }, { status: 400 });
  }

  try {
    const result = await decideAction({
      customerId: customer.id,
      actorClerkUserId: userId,
      actionId: params.actionId,
      decision: 'edit',
      draftContent,
      expectedRevision: typeof form?.get('expectedRevision') === 'string' ? form.get('expectedRevision') as string : undefined,
    });
    return NextResponse.redirect(new URL(`/review/${result.actionId}`, req.url), 303);
  } catch (error) {
    if (error instanceof ActionDecisionError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
