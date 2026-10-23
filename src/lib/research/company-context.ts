export interface CompanyContext {
  name: string | null;
  domains: string[];
  markets: string[];
  languages: string[];
  audience: string | null;
}

export function resolveCompanyContext(
  profile: { businessDescription: string; audience: string | null; markets: string[]; languages: string[] },
  websites: { url: string }[],
): CompanyContext {
  const domains = [...new Set(websites.map((w) => new URL(w.url).hostname))];
  return {
    name: profile.businessDescription.trim() || null,
    domains, markets: profile.markets, languages: profile.languages, audience: profile.audience,
  };
}
