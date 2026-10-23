import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { listProfileSuggestions, ProfileSuggestionError } from '@/lib/profile-suggestions';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { customer, website } = await resolveWebsiteForRequest(
      userId, params.id, new URL(req.url).searchParams.get('clientProfileId') || undefined,
    );
    const suggestions = await listProfileSuggestions({
      customerId: customer.id, clientProfileId: website.clientProfileId, websiteId: website.id,
    });
    return NextResponse.json({ suggestions });
  } catch (error) {
    if (error instanceof WebsiteNotFoundError || error instanceof ProfileSuggestionError && error.code === 'not_found') {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw error;
  }
}
