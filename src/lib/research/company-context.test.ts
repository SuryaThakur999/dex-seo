import { describe, expect, it } from 'vitest';
import { resolveCompanyContext } from './company-context';

describe('resolveCompanyContext', () => {
  it('derives domains from every website on the profile, deduplicated', () => {
    const context = resolveCompanyContext(
      { businessDescription: 'A bakery', audience: 'Local families', markets: ['DE'], languages: ['de'] },
      [{ url: 'https://bakery.test' }, { url: 'https://bakery.test/shop' }],
    );
    expect(context.domains).toEqual(['bakery.test']);
    expect(context.markets).toEqual(['DE']);
  });

  it('never invents a company name when businessDescription is empty', () => {
    const context = resolveCompanyContext({ businessDescription: '', audience: null, markets: [], languages: [] }, []);
    expect(context.name).toBeNull();
  });
});
