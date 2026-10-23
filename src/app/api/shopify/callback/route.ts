import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForAccessToken, isValidShopDomain, verifyOAuthHmac } from '@/lib/shopify-oauth';
import { encrypt } from '@/lib/crypto';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const shop = req.nextUrl.searchParams.get('shop');
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const expectedState = req.cookies.get('shopify_oauth_state')?.value;

  if (!shop || !isValidShopDomain(shop) || !code || !state || !expectedState || state !== expectedState) {
    return new Response('Invalid OAuth callback', { status: 400 });
  }

  if (!verifyOAuthHmac(req.nextUrl.searchParams)) {
    return new Response('Invalid HMAC signature', { status: 400 });
  }

  try {
    const accessToken = await exchangeCodeForAccessToken(shop, code);

    const customer = await db.customer.findUnique({
      where: { clerkUserId: userId },
      include: { clientProfiles: { where: { isDefault: true }, include: { websites: true } } },
    });
    const website = customer?.clientProfiles[0]?.websites[0];
    if (!website) {
      return NextResponse.json(
        { error: 'Visit /dashboard first to set up your account before connecting Shopify.' },
        { status: 400 }
      );
    }

    await db.website.update({
      where: { id: website.id },
      data: { shopifyShopDomain: shop, shopifyAccessToken: encrypt(accessToken) },
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
      return NextResponse.json(
        { error: 'Visit /dashboard first to set up your account before connecting Shopify.' },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to connect Shopify.' }, { status: 500 });
  }

  const response = NextResponse.redirect(new URL('/dashboard', req.url));
  response.cookies.delete('shopify_oauth_state');
  return response;
}
