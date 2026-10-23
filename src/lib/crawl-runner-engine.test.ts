import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  movePlayer,
  stepGhosts,
  checkGhostCollision,
  GRID_COLS,
  GRID_ROWS,
  ORB_COUNT,
  POINTS_PER_ORB,
} from './crawl-runner-engine';

// Deterministic RNG for reproducible test fixtures — real gameplay uses Math.random.
function fixedRng(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('createInitialState', () => {
  it('spawns the player at the origin with a real, non-overlapping orb and ghost set', () => {
    const state = createInitialState(fixedRng(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9));

    expect(state.player).toEqual({ x: 0, y: 0 });
    expect(state.orbs).toHaveLength(ORB_COUNT);
    expect(state.score).toBe(0);
    const allCells = [state.player, ...state.orbs, ...state.ghosts];
    const unique = new Set(allCells.map((c) => `${c.x},${c.y}`));
    expect(unique.size).toBe(allCells.length);
  });
});

describe('movePlayer', () => {
  it('moves one cell in the requested direction', () => {
    const state = { player: { x: 5, y: 5 }, orbs: [], ghosts: [], score: 0 };
    expect(movePlayer(state, 'right').player).toEqual({ x: 6, y: 5 });
    expect(movePlayer(state, 'left').player).toEqual({ x: 4, y: 5 });
    expect(movePlayer(state, 'up').player).toEqual({ x: 5, y: 4 });
    expect(movePlayer(state, 'down').player).toEqual({ x: 5, y: 6 });
  });

  it('clamps movement at every grid edge instead of wrapping or going out of bounds', () => {
    const topLeft = { player: { x: 0, y: 0 }, orbs: [], ghosts: [], score: 0 };
    expect(movePlayer(topLeft, 'left').player).toEqual({ x: 0, y: 0 });
    expect(movePlayer(topLeft, 'up').player).toEqual({ x: 0, y: 0 });

    const bottomRight = { player: { x: GRID_COLS - 1, y: GRID_ROWS - 1 }, orbs: [], ghosts: [], score: 0 };
    expect(movePlayer(bottomRight, 'right').player).toEqual({ x: GRID_COLS - 1, y: GRID_ROWS - 1 });
    expect(movePlayer(bottomRight, 'down').player).toEqual({ x: GRID_COLS - 1, y: GRID_ROWS - 1 });
  });

  it('collects a real orb on the landing cell, adds real points, and removes just that orb', () => {
    const state = {
      player: { x: 4, y: 5 },
      orbs: [{ x: 5, y: 5 }, { x: 8, y: 8 }],
      ghosts: [],
      score: 0,
    };

    const next = movePlayer(state, 'right');

    expect(next.score).toBe(POINTS_PER_ORB);
    expect(next.orbs).toEqual([{ x: 8, y: 8 }]);
  });

  it('respawns a fresh full orb set once the last real orb is collected, never leaving zero', () => {
    const state = { player: { x: 4, y: 5 }, orbs: [{ x: 5, y: 5 }], ghosts: [], score: 40 };

    const next = movePlayer(state, 'right', fixedRng(0.1, 0.2, 0.3, 0.4, 0.5, 0.6));

    expect(next.score).toBe(50);
    expect(next.orbs).toHaveLength(ORB_COUNT);
    expect(next.orbs.some((o) => o.x === next.player.x && o.y === next.player.y)).toBe(false);
  });

  it('does not collect anything or change score when the landing cell has no orb', () => {
    const state = { player: { x: 0, y: 0 }, orbs: [{ x: 9, y: 9 }], ghosts: [], score: 0 };

    const next = movePlayer(state, 'right');

    expect(next.score).toBe(0);
    expect(next.orbs).toEqual([{ x: 9, y: 9 }]);
  });
});

describe('stepGhosts', () => {
  it('moves every ghost by at most one cell, staying within the grid', () => {
    const state = {
      player: { x: 0, y: 0 },
      orbs: [],
      ghosts: [{ x: 0, y: 0 }, { x: GRID_COLS - 1, y: GRID_ROWS - 1 }],
      score: 0,
    };

    const next = stepGhosts(state, fixedRng(0, 0.99));

    for (let i = 0; i < next.ghosts.length; i++) {
      const dx = Math.abs(next.ghosts[i].x - state.ghosts[i].x);
      const dy = Math.abs(next.ghosts[i].y - state.ghosts[i].y);
      expect(dx + dy).toBeLessThanOrEqual(1);
      expect(next.ghosts[i].x).toBeGreaterThanOrEqual(0);
      expect(next.ghosts[i].x).toBeLessThan(GRID_COLS);
      expect(next.ghosts[i].y).toBeGreaterThanOrEqual(0);
      expect(next.ghosts[i].y).toBeLessThan(GRID_ROWS);
    }
  });
});

describe('checkGhostCollision', () => {
  it('resets the player to the origin, with no score penalty, on a real ghost hit', () => {
    const state = { player: { x: 3, y: 3 }, orbs: [], ghosts: [{ x: 3, y: 3 }], score: 70 };

    const next = checkGhostCollision(state);

    expect(next.player).toEqual({ x: 0, y: 0 });
    expect(next.score).toBe(70);
  });

  it('leaves the state unchanged when no ghost occupies the player cell', () => {
    const state = { player: { x: 3, y: 3 }, orbs: [], ghosts: [{ x: 5, y: 5 }], score: 20 };

    expect(checkGhostCollision(state)).toEqual(state);
  });
});
