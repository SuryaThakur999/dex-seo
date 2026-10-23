const GERMAN_MARKET_TERMS = new Set(['germany', 'de', 'dach']);

// Dashboard IA rebuild (2026-10-16 spec): "When a German market is set, default the language
// to German." Deliberately narrow (Germany/DE/DACH only, not Austria/Switzerland alone) --
// those two are themselves multi-language (Austria: German; Switzerland: German/French/
// Italian/Romansh), so matching on them alone would guess a language the spec didn't ask for.
export function isGermanMarket(market: string): boolean {
  return GERMAN_MARKET_TERMS.has(market.trim().toLowerCase());
}
