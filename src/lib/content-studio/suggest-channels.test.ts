import { describe, it, expect } from 'vitest';
import { suggestChannelsForAction } from './suggest-channels';

describe('suggestChannelsForAction', () => {
  it('returns linkedin and x suggestions for meta_description, each with a non-empty rationale', () => {
    const result = suggestChannelsForAction('meta_description');
    expect(result.map((r) => r.platform)).toEqual(['linkedin', 'x']);
    for (const r of result) {
      expect(r.rationale.length).toBeGreaterThan(0);
    }
  });

  it('returns an empty array for an unrecognized actionType', () => {
    expect(suggestChannelsForAction('not_a_real_action_type')).toEqual([]);
  });

  it('returns a linkedin suggestion for zero_internal_links, with a non-empty rationale', () => {
    const result = suggestChannelsForAction('zero_internal_links');
    expect(result.map((r) => r.platform)).toEqual(['linkedin']);
    expect(result[0].rationale.length).toBeGreaterThan(0);
  });

  it('returns no suggestion for pure markup fixes — not every SEO issue needs a social post', () => {
    expect(suggestChannelsForAction('missing_canonical')).toEqual([]);
    expect(suggestChannelsForAction('invalid_canonical')).toEqual([]);
    expect(suggestChannelsForAction('canonical_points_elsewhere')).toEqual([]);
    expect(suggestChannelsForAction('missing_structured_data')).toEqual([]);
  });
});
