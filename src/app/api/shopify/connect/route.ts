import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { buildAuthUrl, isValidShopDomain } from '@/lib/shopify-oauth';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const shop = req.nextUrl.searchParams.get('shop');
  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json({ error: 'shop must be a valid *.myshopify.com domain' }, { status: 400 });
  }

  const state = randomBytes(32).toString('hex');
  const response = NextResponse.redirect(buildAuthUrl(shop, state));
  response.cookies.set('shopify_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });
  return response;
}
