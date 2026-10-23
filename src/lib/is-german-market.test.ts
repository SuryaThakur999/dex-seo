import { describe, expect, it } from 'vitest';
import { isGermanMarket } from './is-german-market';

describe('isGermanMarket', () => {
  it.each(['Germany', 'germany', 'DE', 'DACH', 'dach'])('matches %s', (market) => {
    expect(isGermanMarket(market)).toBe(true);
  });
  it.each(['United States', 'France', '', 'Germanyland'])('does not match %s', (market) => {
    expect(isGermanMarket(market)).toBe(false);
  });
});
