export interface PageSnapshot {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface FlaggedPage extends PageSnapshot {
  flagReason: string;
}

const MIN_META_LENGTH = 50;
const MAX_META_LENGTH = 155;
// Starting thresholds for "worth a rewrite even though the meta description
// is technically fine" — a page Google shows often but users rarely click.
// Tune once real customer data exists (spec Section 9 open question).
const HIGH_IMPRESSION_THRESHOLD = 100;
const LOW_CTR_THRESHOLD = 0.02;

export function flagPages(pages: PageSnapshot[]): FlaggedPage[] {
  const flagged: FlaggedPage[] = [];

  for (const page of pages) {
    if (!page.metaDescription) {
      flagged.push({ ...page, flagReason: 'Missing meta description.' });
      continue;
    }

    const length = page.metaDescription.trim().length;

    if (length < MIN_META_LENGTH) {
      flagged.push({ ...page, flagReason: `Meta description is too short (${length} characters).` });
      continue;
    }

    if (length > MAX_META_LENGTH) {
      flagged.push({ ...page, flagReason: `Meta description is too long (${length} characters).` });
      continue;
    }

    if (page.impressions >= HIGH_IMPRESSION_THRESHOLD && page.ctr < LOW_CTR_THRESHOLD) {
      flagged.push({
        ...page,
        flagReason: `High impressions (${page.impressions}) with low click-through rate (${(page.ctr * 100).toFixed(1)}%) — the meta description may not be compelling enough.`,
      });
    }
  }

  return flagged;
}
