import { describe, expect, it } from 'vitest';
import { buildTypeFilterOptions, resolveTypeFilter } from './review-queue-filter';

const actions = [
  { actionType: 'meta_description' },
  { actionType: 'internal_link_fix' },
  { actionType: 'meta_description' },
  { actionType: 'canonical_fix' },
  { actionType: 'meta_description' },
  { actionType: 'internal_link_fix' },
];

describe('buildTypeFilterOptions', () => {
  it('counts each actionType actually present, most common first', () => {
    expect(buildTypeFilterOptions(actions)).toEqual([
      { actionType: 'meta_description', label: 'Meta description change', count: 3 },
      { actionType: 'internal_link_fix', label: 'Internal link suggestion', count: 2 },
      { actionType: 'canonical_fix', label: 'Canonical tag fix', count: 1 },
    ]);
  });

  it('breaks count ties by label so the order is stable across renders', () => {
    const options = buildTypeFilterOptions([{ actionType: 'structured_data_fix' }, { actionType: 'canonical_fix' }]);
    expect(options.map((o) => o.actionType)).toEqual(['canonical_fix', 'structured_data_fix']);
  });

  it('falls back to the raw actionType as label for a type with no copy yet', () => {
    expect(buildTypeFilterOptions([{ actionType: 'future_fix' }])).toEqual([
      { actionType: 'future_fix', label: 'future_fix', count: 1 },
    ]);
  });

  it('returns no options for an empty queue', () => {
    expect(buildTypeFilterOptions([])).toEqual([]);
  });
});

describe('resolveTypeFilter', () => {
  const options = buildTypeFilterOptions(actions);

  it('returns the requested type when it is present in the pending set', () => {
    expect(resolveTypeFilter('canonical_fix', options)).toBe('canonical_fix');
  });

  it('falls back to null (All) for a type with no pending items left', () => {
    expect(resolveTypeFilter('structured_data_fix', options)).toBeNull();
  });

  it('falls back to null for a missing or garbage param', () => {
    expect(resolveTypeFilter(undefined, options)).toBeNull();
    expect(resolveTypeFilter('', options)).toBeNull();
    expect(resolveTypeFilter('<script>', options)).toBeNull();
  });

  it('takes the first value when the param is repeated', () => {
    expect(resolveTypeFilter(['internal_link_fix', 'canonical_fix'], options)).toBe('internal_link_fix');
  });

  // Phase 2E matrix (Ryan's 2026-10-04 note): "if filters produce no rows while other decision
  // types remain, explain that state and offer a way to clear the filter." resolveTypeFilter can
  // only ever resolve to an actionType present in `options`, and every option in `options` has
  // count >= 1 by construction (buildTypeFilterOptions only emits types actually seen) -- so a
  // resolved (non-null) activeType can never filter the matching action list down to zero rows.
  // This closes the acceptance item by proving the empty-filtered-queue case is structurally
  // unreachable, not by adding a UI message for a state the code cannot produce.
  it('never resolves to a type whose count would filter the action list to zero rows', () => {
    for (const option of options) {
      const resolved = resolveTypeFilter(option.actionType, options);
      expect(resolved).toBe(option.actionType);
      expect(actions.filter((a) => a.actionType === resolved)).toHaveLength(option.count);
      expect(option.count).toBeGreaterThan(0);
    }
  });
});
