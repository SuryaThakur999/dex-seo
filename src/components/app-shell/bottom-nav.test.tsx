import { describe, it, expect } from 'vitest';
import { isNavItemActive, formatBadgeCount } from './bottom-nav';

// BottomNav itself uses hooks (useState/useEffect for scroll-hide and last-website
// tracking), so it can't be called as a plain function and inspected like
// scan-stage-breadcrumb.test.tsx does for hookless components — confirmed by running
// it directly, which throws "Invalid hook call" (no dispatcher outside a real render,
// and this repo has no @testing-library/react or jsdom environment to render into).
// Following this project's actual precedent for a hooks-using client component
// (dashboard-tabs.test.tsx, from Task 2 of this same plan): the component exports its
// pure decision logic and the tests exercise that directly.
describe('isNavItemActive', () => {
  it('marks the Review item active when the current path matches exactly', () => {
    expect(isNavItemActive('/review', '/review')).toBe(true);
  });

  it('marks an item active when the current path is nested under its href', () => {
    expect(isNavItemActive('/review/123', '/review')).toBe(true);
  });

  it('does not mark an unrelated item active', () => {
    expect(isNavItemActive('/review', '/settings')).toBe(false);
  });

  it('does not treat a different item with a shared prefix as active', () => {
    expect(isNavItemActive('/reviewer', '/review')).toBe(false);
  });
});

describe('formatBadgeCount', () => {
  it('shows the pending review count when greater than zero', () => {
    expect(formatBadgeCount(5)).toBe('5');
  });

  it('hides the badge when the count is zero', () => {
    expect(formatBadgeCount(0)).toBeNull();
  });

  it('caps the displayed badge at 99+', () => {
    expect(formatBadgeCount(150)).toBe('99+');
  });

  it('shows the exact count at the 99 boundary', () => {
    expect(formatBadgeCount(99)).toBe('99');
  });
});
