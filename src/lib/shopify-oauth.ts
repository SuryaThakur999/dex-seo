import { createHmac, timingSafeEqual } from 'node:crypto';

const READONLY_SCOPES = 'read_products,read_content';
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN_PATTERN.test(shop);
}

export function buildAuthUrl(shop: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY!,
    scope: READONLY_SCOPES,
    redirect_uri: process.env.SHOPIFY_REDIRECT_URI!,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

// Shopify signs the OAuth callback query string (every param except hmac and
// signature, sorted, url-decoded, joined with &) with HMAC-SHA256 hex over the
// app's client secret. Verifying this — not just the state nonce — is what
// proves the callback actually came from Shopify and wasn't forged.
export function verifyOAuthHmac(searchParams: URLSearchParams): boolean {
  const hmac = searchParams.get('hmac');
  if (!hmac) return false;

  const message = Array.from(searchParams.entries())
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const computed = createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
  const computedBuf = Buffer.from(computed, 'hex');
  const providedBuf = Buffer.from(hmac, 'hex');
  return computedBuf.length === providedBuf.length && timingSafeEqual(computedBuf, providedBuf);
}

// Shopify webhook requests sign the raw request body (not the query string) as
// base64 HMAC-SHA256, delivered in the X-Shopify-Hmac-Sha256 header — a
// different scheme from the OAuth callback's hex-over-query-string above.
export function verifyWebhookHmac(rawBody: string, headerHmac: string | null): boolean {
  if (!headerHmac) return false;
  const computed = createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(rawBody, 'utf8').digest('base64');
  const computedBuf = Buffer.from(computed, 'base64');
  const providedBuf = Buffer.from(headerHmac, 'base64');
  return computedBuf.length === providedBuf.length && timingSafeEqual(computedBuf, providedBuf);
}

export async function exchangeCodeForAccessToken(shop: string, code: string): Promise<string> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Shopify did not return an access_token');
  }
  return data.access_token;
}
