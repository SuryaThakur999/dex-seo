import { NextRequest } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify-oauth';
import { db } from '@/lib/db';

// Shopify's mandatory shop/redact webhook, fired ~48 hours after a merchant
// uninstalls the app. Unlike the other two compliance webhooks, this one has
// real data to remove: the shop's stored domain and access token.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get('X-Shopify-Hmac-Sha256');

  if (!verifyWebhookHmac(rawBody, hmac)) {
    return new Response('Invalid HMAC signature', { status: 401 });
  }

  const { shop_domain: shopDomain } = JSON.parse(rawBody) as { shop_domain?: string };
  if (shopDomain) {
    await db.website.updateMany({
      where: { shopifyShopDomain: shopDomain },
      data: { shopifyShopDomain: null, shopifyAccessToken: null },
    });
  }

  return new Response(null, { status: 200 });
}
