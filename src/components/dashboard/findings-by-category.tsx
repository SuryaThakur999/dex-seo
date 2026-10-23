import type { CategoryCount } from '@/lib/dashboard-stats';

// Labels the categories the codebase actually produces; anything unrecognized falls
// back to its raw actionType rather than a made-up name.
const CATEGORY_LABEL: Record<string, string> = {
  meta_description: 'Meta description',
  canonical_fix: 'Canonical tag',
  structured_data_fix: 'Structured data',
  entity_markup_fix: 'Entity markup',
  restricted_wording_fix: 'Restricted wording',
  internal_link_fix: 'Internal links',
};

// Deliberately not a chart: with one real category today, a bar/pie showing 100% of one
// thing takes space without adding information. This renders only when the caller has 2+
// categories (see its call site) — a compact inline breakdown, not a dedicated card.
export function FindingsByCategory({ categories }: { categories: CategoryCount[] }) {
  return (
    <p className="text-xs text-muted-foreground">
      By category:{' '}
      {categories.map((c, i) => (
        <span key={c.category}>
          {i > 0 && ', '}
          {CATEGORY_LABEL[c.category] ?? c.category} ({c.count})
        </span>
      ))}
    </p>
  );
}
