import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeSiteUrl } from '@/lib/entitlements';
import { resolveWebsiteForRequest, WebsiteNotFoundError, PENDING_WEBSITE_URL } from '@/lib/customer';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData();
  const url = form.get('url');
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'A URL is required.' }, { status: 400 });
  }

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, params.id));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  if (website.url !== PENDING_WEBSITE_URL) {
    return NextResponse.json({ error: "This website's URL is already confirmed." }, { status: 400 });
  }

  if (normalizeSiteUrl(url.trim()) === normalizeSiteUrl(PENDING_WEBSITE_URL)) {
    return NextResponse.json({ error: "Enter your website's real URL, not the placeholder." }, { status: 400 });
  }

  await db.website.update({
    where: { id: website.id },
    data: { url: url.trim(), normalizedHost: normalizeSiteUrl(url.trim()) },
  });

  return NextResponse.redirect(new URL(`/dashboard/${website.id}`, req.url), 303);
}
