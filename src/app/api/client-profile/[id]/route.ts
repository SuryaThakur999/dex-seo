import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Brief section 9 ("Controlled Learning"): "preferences must be inspectable and reversible."
// ClientProfile.brandVoice/approvedClaims/restrictedWording already gate every content
// generation (Content Studio prompts, ProofLayer's restricted-wording check) but had no
// customer-facing way to view or edit them — this is that surface. All fields here are
// customer-stated preferences, not inferred ones (no inference system exists yet in this
// codebase — this route does not conflate the two).
const MAX_TEXT_LENGTH = 2000;
const MAX_LIST_ITEMS = 50;
const MAX_ITEM_LENGTH = 300;

function parseStringList(value: unknown, field: string): string[] | { error: string } {
  if (!Array.isArray(value)) return { error: `${field} must be an array of strings.` };
  if (value.length > MAX_LIST_ITEMS) return { error: `${field} may have at most ${MAX_LIST_ITEMS} items.` };
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return { error: `${field} items must be strings.` };
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_ITEM_LENGTH) return { error: `${field} items must be ${MAX_ITEM_LENGTH} characters or fewer.` };
    items.push(trimmed);
  }
  return items;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const profile = await db.clientProfile.findFirst({
    where: { id: params.id, customer: { clerkUserId: userId } },
  });
  if (!profile) return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });

  const body = await req.json();
  const data: {
    brandVoice?: string | null;
    audience?: string | null;
    approvedClaims?: string[];
    restrictedWording?: string[];
    markets?: string[];
    languages?: string[];
  } = {};

  if ('brandVoice' in body) {
    if (typeof body.brandVoice !== 'string' && body.brandVoice !== null) {
      return NextResponse.json({ error: 'brandVoice must be a string or null.' }, { status: 400 });
    }
    if (typeof body.brandVoice === 'string' && body.brandVoice.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: `brandVoice must be ${MAX_TEXT_LENGTH} characters or fewer.` }, { status: 400 });
    }
    data.brandVoice = body.brandVoice;
  }
  if ('audience' in body) {
    if (typeof body.audience !== 'string' && body.audience !== null) {
      return NextResponse.json({ error: 'audience must be a string or null.' }, { status: 400 });
    }
    if (typeof body.audience === 'string' && body.audience.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: `audience must be ${MAX_TEXT_LENGTH} characters or fewer.` }, { status: 400 });
    }
    data.audience = body.audience;
  }
  if ('approvedClaims' in body) {
    const result = parseStringList(body.approvedClaims, 'approvedClaims');
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    data.approvedClaims = result;
  }
  if ('restrictedWording' in body) {
    const result = parseStringList(body.restrictedWording, 'restrictedWording');
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    data.restrictedWording = result;
  }
  if ('markets' in body) {
    const result = parseStringList(body.markets, 'markets');
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    data.markets = result;
  }
  if ('languages' in body) {
    const result = parseStringList(body.languages, 'languages');
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    data.languages = result;
  }

  const updated = await db.clientProfile.update({ where: { id: profile.id }, data });
  return NextResponse.json(updated);
}
