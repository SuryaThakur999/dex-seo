import type { ContentPlatform } from '@prisma/client';

export interface ChannelSuggestion {
  platform: ContentPlatform;
  rationale: string;
}

// A static lookup, not a scoring model — one entry per actionType/ruleId this codebase
// actually produces, so a general scoring system would be solving a problem it doesn't have
// yet. An unrecognized key returns [] deliberately: not every SEO issue needs a social post.
// The SEO Specialist's other rules (missing_canonical, invalid_canonical,
// canonical_points_elsewhere, missing_structured_data) are pure on-page markup fixes with no
// content angle and are deliberately NOT listed here — forcing a content CTA onto a markup fix
// would be exactly the "not every issue needs a post" mistake this lookup exists to avoid.
const SUGGESTIONS: Record<string, ChannelSuggestion[]> = {
  meta_description: [
    {
      platform: 'linkedin',
      rationale: 'Good fit for announcing an on-page content update to a professional audience.',
    },
    { platform: 'x', rationale: 'Short-form, works well for a quick update post.' },
  ],
  // A page with zero internal links has no path to it from the rest of the site — a real
  // content piece that links to it is an actual fix, not a manufactured content opportunity.
  zero_internal_links: [
    {
      platform: 'linkedin',
      rationale: 'A post linking to this page gives it a real inbound path beyond the crawl.',
    },
  ],
};

export function suggestChannelsForAction(actionType: string): ChannelSuggestion[] {
  return SUGGESTIONS[actionType] ?? [];
}
