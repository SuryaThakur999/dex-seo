import { describe, expect, it } from 'vitest';
import { PENDING_WEBSITE_URL } from '@/lib/customer';
import { parseSignupSite, signupRedirect, signupSitePrefill } from './signup-site';

const pending = { id: 'pending', url: PENDING_WEBSITE_URL };
const bakery = { id: 'bakery', url: 'https://bakery.de' };
const shop = { id: 'shop', url: 'https://shop.de' };

describe('sign-up site handoff', () => {
  it('normalizes a bare host and preserves a supplied URL', () => {
    expect(parseSignupSite('bakery.de')).toBe('https://bakery.de/');
    expect(parseSignupSite('https://bakery.de/about?q=1')).toBe('https://bakery.de/about?q=1');
  });

  it.each([
    undefined,
    '',
    ['https://bakery.de'],
    'javascript:alert(1)',
    'ftp://bakery.de',
    'https://user:pass@bakery.de',
    'not a url',
    PENDING_WEBSITE_URL,
  ])('ignores invalid input %s', (value) => {
    expect(parseSignupSite(value)).toBeUndefined();
    expect(signupRedirect(value)).toBe('/dashboard');
  });

  it('uses a local redirect with an encoded site', () => {
    expect(signupRedirect('https://bakery.de/?a=1&b=2')).toBe(
      '/settings?site=https%3A%2F%2Fbakery.de%2F%3Fa%3D1%26b%3D2',
    );
  });

  it('prefills the first placeholder for a new account without saving', () => {
    expect(signupSitePrefill(pending, [pending], 'bakery.de')).toEqual({
      selected: pending,
      pendingId: 'pending',
      initialUrl: 'https://bakery.de/',
    });
  });

  it('selects an existing matching host, ignoring www and path', () => {
    expect(
      signupSitePrefill(pending, [pending, bakery, shop], 'https://www.shop.de/about'),
    ).toEqual({ selected: shop, initialUrl: '' });
  });

  it('keeps a confirmed default and prefills Add for an unmatched site', () => {
    expect(signupSitePrefill(pending, [pending, bakery], 'shop.de')).toEqual({
      selected: bakery,
      initialUrl: 'https://shop.de/',
    });
  });

  it('honors an explicit selection over the matching host', () => {
    expect(signupSitePrefill(bakery, [pending, bakery, shop], 'shop.de', 'bakery').selected).toBe(bakery);
  });

  it('keeps the existing confirmed default for invalid input', () => {
    expect(signupSitePrefill(pending, [pending, bakery], undefined)).toEqual({ selected: bakery, initialUrl: '' });
  });
});
