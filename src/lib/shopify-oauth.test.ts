import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildAuthUrl, isValidShopDomain, verifyOAuthHmac, verifyWebhookHmac } from './shopify-oauth';

beforeAll(() => {
  process.env.SHOPIFY_API_KEY = 'test-client-id';
  process.env.SHOPIFY_API_SECRET = 'test-client-secret';
  process.env.SHOPIFY_REDIRECT_URI = 'http://localhost:3000/api/shopify/callback';
});

describe('isValidShopDomain', () => {
  it('accepts a real *.myshopify.com domain', () => {
    expect(isValidShopDomain('some-store.myshopify.com')).toBe(true);
  });

  it('rejects a bare domain without the myshopify.com suffix', () => {
    expect(isValidShopDomain('some-store.com')).toBe(false);
  });

  it('rejects an attempted injection through the shop parameter', () => {
    expect(isValidShopDomain('evil.com/admin/oauth/authorize?shop=real.myshopify.com')).toBe(false);
  });
});

describe('buildAuthUrl', () => {
  it('requests only the read-only product and content scopes', () => {
    const url = buildAuthUrl('some-store.myshopify.com', 'some-state');
    expect(url).toContain('scope=read_products%2Cread_content');
  });

  it('targets the specific shop domain, not a generic Shopify host', () => {
    const url = buildAuthUrl('some-store.myshopify.com', 'some-state');
    expect(url.startsWith('https://some-store.myshopify.com/admin/oauth/authorize?')).toBe(true);
  });

  it('includes the provided state parameter', () => {
    const url = buildAuthUrl('some-store.myshopify.com', 'some-state');
    expect(url).toContain('state=some-state');
  });
});

describe('verifyOAuthHmac', () => {
  function signedParams(params: Record<string, string>): URLSearchParams {
    const message = Object.entries(params)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const hmac = createHmac('sha256', 'test-client-secret').update(message).digest('hex');
    return new URLSearchParams({ ...params, hmac });
  }

  it('accepts a correctly signed callback', () => {
    const params = signedParams({ shop: 'some-store.myshopify.com', code: 'abc123', state: 'xyz' });
    expect(verifyOAuthHmac(params)).toBe(true);
  });

  it('rejects a callback with a tampered parameter', () => {
    const params = signedParams({ shop: 'some-store.myshopify.com', code: 'abc123', state: 'xyz' });
    params.set('shop', 'attacker-store.myshopify.com');
    expect(verifyOAuthHmac(params)).toBe(false);
  });

  it('rejects a callback with no hmac at all', () => {
    const params = new URLSearchParams({ shop: 'some-store.myshopify.com', code: 'abc123' });
    expect(verifyOAuthHmac(params)).toBe(false);
  });
});

describe('verifyWebhookHmac', () => {
  it('accepts a correctly signed webhook body', () => {
    const body = JSON.stringify({ shop_domain: 'some-store.myshopify.com' });
    const hmac = createHmac('sha256', 'test-client-secret').update(body, 'utf8').digest('base64');
    expect(verifyWebhookHmac(body, hmac)).toBe(true);
  });

  it('rejects a webhook body that does not match the provided signature', () => {
    const body = JSON.stringify({ shop_domain: 'some-store.myshopify.com' });
    const wrongHmac = createHmac('sha256', 'wrong-secret').update(body, 'utf8').digest('base64');
    expect(verifyWebhookHmac(body, wrongHmac)).toBe(false);
  });

  it('rejects a webhook with no signature header', () => {
    expect(verifyWebhookHmac('{}', null)).toBe(false);
  });
});
