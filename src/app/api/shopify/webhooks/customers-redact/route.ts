import { NextRequest } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify-oauth';

// Shopify's mandatory GDPR compliance webhook, required for every Public app.
// Dex never stores a merchant's customer data (only the shop's own domain and
// our encrypted access token) — nothing to return, but the endpoint itself
// must exist and verify HMAC per Shopify's Partner Program requirements.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get('X-Shopify-Hmac-Sha256');

  if (!verifyWebhookHmac(rawBody, hmac)) {
    return new Response('Invalid HMAC signature', { status: 401 });
  }

  return new Response(null, { status: 200 });
}
