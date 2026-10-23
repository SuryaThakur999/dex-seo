import { describe, it, expect } from 'vitest';
import { getSwipeTargetTab } from './dashboard-tabs';

describe('getSwipeTargetTab', () => {
  it('returns the next tab index on a qualifying leftward swipe (finger moves left = next tab)', () => {
    // distance threshold: |offsetX| > 50, velocity threshold: |velocityX| > 0.11 px/ms (500 px/s here, well over)
    expect(getSwipeTargetTab(0, -80, -500, 3)).toBe(1);
  });

  it('returns the previous tab index on a qualifying rightward swipe', () => {
    expect(getSwipeTargetTab(1, 80, 500, 3)).toBe(0);
  });

  it('returns null when the swipe is under both thresholds', () => {
    expect(getSwipeTargetTab(0, -20, -50, 3)).toBeNull();
  });

  it('returns null at the last tab swiping further left (no wraparound)', () => {
    expect(getSwipeTargetTab(2, -80, -500, 3)).toBeNull();
  });

  it('returns null at the first tab swiping further right (no wraparound)', () => {
    expect(getSwipeTargetTab(0, 80, 500, 3)).toBeNull();
  });

  it('qualifies on velocity alone even with a short distance (a fast flick)', () => {
    expect(getSwipeTargetTab(0, -20, -600, 3)).toBe(1);
  });
});
