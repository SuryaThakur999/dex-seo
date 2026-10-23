import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { decideProfileSuggestion, ProfileSuggestionError } from '@/lib/profile-suggestions';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; suggestionId: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !['accept', 'reject'].includes(body.action)
    || body.action === 'accept' && body.value !== undefined && typeof body.value !== 'string' && !Array.isArray(body.value)) {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }
  try {
    const { customer, website } = await resolveWebsiteForRequest(
      userId, params.id, new URL(req.url).searchParams.get('clientProfileId') || undefined,
    );
    const result = await decideProfileSuggestion({
      customerId: customer.id, clientProfileId: website.clientProfileId, websiteId: website.id,
    }, params.suggestionId, { action: body.action, ...(body.action === 'accept' && body.value !== undefined ? { value: body.value } : {}) });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    if (error instanceof ProfileSuggestionError) {
      const status = { not_found: 404, conflict: 409, invalid: 400 }[error.code];
      const message = { not_found: 'Suggestion not found', conflict: 'Suggestion already decided', invalid: 'Invalid suggestion value' }[error.code];
      return NextResponse.json({ error: message }, { status });
    }
    throw error;
  }
}
