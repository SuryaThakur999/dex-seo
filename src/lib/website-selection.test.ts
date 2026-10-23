import { describe, expect, it } from 'vitest';
import { PENDING_WEBSITE_URL } from '@/lib/customer';
import { defaultStudioWebsite, selectableWebsites } from './website-selection';

const pending = { id: 'p', url: PENDING_WEBSITE_URL };
const real = { id: 'r', url: 'https://bakery.de' };
const shop = { id: 's', url: 'https://shop.bakery.de' };

describe('studio website selection', () => {
  it('skips the sign-up placeholder when no website is requested', () => {
    expect(defaultStudioWebsite(pending, [pending, real, shop])).toBe(real);
  });

  it('keeps an explicitly requested website', () => {
    expect(defaultStudioWebsite(pending, [pending, real], 'p')).toBe(pending);
  });

  it('falls back to the placeholder when it is the only website', () => {
    expect(defaultStudioWebsite(pending, [pending])).toBe(pending);
  });

  it('never offers the placeholder in the picker', () => {
    expect(selectableWebsites([pending, real, shop])).toEqual([real, shop]);
  });
});
