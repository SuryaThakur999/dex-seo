import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { buildAuthUrl } from '@/lib/google-oauth';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const url = new URL(req.url);
  const websiteId = url.searchParams.get('websiteId');
  if (!websiteId) {
    return NextResponse.json({ error: 'websiteId is required' }, { status: 400 });
  }

  try {
    await resolveWebsiteForRequest(userId, websiteId);
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 400 });
    }
    throw err;
  }

  const state = randomBytes(32).toString('hex');
  const response = NextResponse.redirect(buildAuthUrl(state));
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  };
  response.cookies.set('gsc_oauth_state', state, cookieOptions);
  response.cookies.set('gsc_oauth_website_id', websiteId, cookieOptions);
  return response;
}
