// The one place the operator's legal details live. Every legal page reads from here.
// Never fill a placeholder with a guess: an Impressum with invented details is worse than an
// unfinished one. Placeholders are shown highlighted on the page until the human supplies them.

export const PLACEHOLDER = (label: string) => `[${label}]`;

export const OPERATOR = {
  name: 'Surya Vir Thakur',
  brand: 'Dex',
  street: PLACEHOLDER('Köhlerstraße + Hausnummer / house number'),
  postcode: '04315',
  city: 'Leipzig',
  country: { de: 'Deutschland', en: 'Germany' },
  email: 'dexai.support@proton.me',
  // Saxony's data protection authority, which is competent for an operator seated in Leipzig.
  authority: {
    name: 'Sächsische Datenschutz- und Transparenzbeauftragte',
    url: 'https://www.datenschutz.sachsen.de',
  },
} as const;

export const LEGAL_UPDATED = { de: '19. Oktober 2026', en: '19 October 2026' } as const;

/** True once every placeholder above is replaced with a real value. Until then the legal
 *  pages stay out of search engines (noindex) and the sitemap. */
export const LEGAL_COMPLETE = ![OPERATOR.street, OPERATOR.email].some((v) => v.startsWith('['));
