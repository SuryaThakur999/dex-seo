export type Lang = 'de' | 'en';

/** A paragraph, a bullet list, or a simple table. Plain text only: no HTML is ever injected. */
export type LegalBlock =
  | string
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { link: { label: string; href: string } };

export type LegalSection = { heading: string; blocks: LegalBlock[] };

export type LegalDoc = { title: string; intro?: string; sections: LegalSection[] };

export type LegalDocPair = Record<Lang, LegalDoc>;
