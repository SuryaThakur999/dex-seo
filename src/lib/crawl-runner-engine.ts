// Pure, deterministic game logic for the Crawl Runner mini-game — DEX CONTINUATION MASTER
// DIRECTIVE Phase 4: an original, optional game a customer can play while a real scan runs.
// Kept fully separate from any audit/scan code: this module makes zero network calls, touches
// no scan state, and nothing here can start, stop, accelerate or delay a real audit. Rendering
// (CrawlRunner.tsx) is a thin canvas wrapper around this — separated so the actual game rules
// are unit-testable without a DOM or canvas context.
//
// Original mechanics only, no borrowed IP: collect "signal orbs" (search-signal metaphor,
// not coins), avoid "404 ghosts" (a real HTTP status as the antagonist, not a licensed
// character). Score is always "Arcade score" — DEX CONTINUATION MASTER DIRECTIVE: "show
// Arcade score, never 'SEO score'."

export const GRID_COLS = 12;
export const GRID_ROWS = 8;
export const ORB_COUNT = 6;
export const GHOST_COUNT = 3;
export const POINTS_PER_ORB = 10;

export interface Cell {
  x: number;
  y: number;
}

export interface CrawlRunnerState {
  player: Cell;
  orbs: Cell[];
  ghosts: Cell[];
  score: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

type Rng = () => number;

function randomCell(rng: Rng, exclude: Cell[]): Cell {
  // Bounded retry, not an infinite loop: with GRID_COLS*GRID_ROWS = 96 cells and at most
  // ORB_COUNT+GHOST_COUNT+1 (10) ever excluded, collision on any single draw is rare, but a
  // hard cap keeps this provably terminating rather than trusting probability.
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = { x: Math.floor(rng() * GRID_COLS), y: Math.floor(rng() * GRID_ROWS) };
    if (!exclude.some((c) => c.x === cell.x && c.y === cell.y)) return cell;
  }
  return { x: 0, y: 0 };
}

export function createInitialState(rng: Rng = Math.random): CrawlRunnerState {
  const player: Cell = { x: 0, y: 0 };
  const orbs: Cell[] = [];
  for (let i = 0; i < ORB_COUNT; i++) {
    orbs.push(randomCell(rng, [player, ...orbs]));
  }
  const ghosts: Cell[] = [];
  for (let i = 0; i < GHOST_COUNT; i++) {
    // Ghosts start away from the player's spawn so the game never opens with an unavoidable hit.
    ghosts.push(randomCell(rng, [player, ...orbs, ...ghosts, { x: 1, y: 0 }, { x: 0, y: 1 }]));
  }
  return { player, orbs, ghosts, score: 0 };
}

const DIRECTION_DELTA: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Moves the player one cell, collects an orb if the new cell holds one (respawning a fresh
// full set once every orb is collected, so a customer waiting on a longer scan always has
// something to keep collecting), and returns a new state. Pure — the caller decides when to
// call this (a keypress or a touch-control tap), so there is no internal timer here at all.
export function movePlayer(state: CrawlRunnerState, direction: Direction, rng: Rng = Math.random): CrawlRunnerState {
  const delta = DIRECTION_DELTA[direction];
  const next: Cell = {
    x: clamp(state.player.x + delta.x, 0, GRID_COLS - 1),
    y: clamp(state.player.y + delta.y, 0, GRID_ROWS - 1),
  };

  const orbIndex = state.orbs.findIndex((o) => o.x === next.x && o.y === next.y);
  if (orbIndex === -1) {
    return { ...state, player: next };
  }

  const remainingOrbs = state.orbs.filter((_, i) => i !== orbIndex);
  const score = state.score + POINTS_PER_ORB;
  if (remainingOrbs.length > 0) {
    return { ...state, player: next, orbs: remainingOrbs, score };
  }
  // Every orb collected — respawn a fresh set, excluding the player's new position.
  const freshOrbs: Cell[] = [];
  for (let i = 0; i < ORB_COUNT; i++) {
    freshOrbs.push(randomCell(rng, [next, ...freshOrbs]));
  }
  return { ...state, player: next, orbs: freshOrbs, score };
}

// One ghost movement tick: each ghost takes one random cardinal step (or stays put), clamped
// to the grid. Deliberately not chasing the player — this is meant to be a light, low-stakes
// distraction while a real scan runs, not a punishing game.
export function stepGhosts(state: CrawlRunnerState, rng: Rng = Math.random): CrawlRunnerState {
  const directions: (Direction | null)[] = ['up', 'down', 'left', 'right', null];
  const ghosts = state.ghosts.map((ghost) => {
    const pick = directions[Math.floor(rng() * directions.length)];
    if (!pick) return ghost;
    const delta = DIRECTION_DELTA[pick];
    return { x: clamp(ghost.x + delta.x, 0, GRID_COLS - 1), y: clamp(ghost.y + delta.y, 0, GRID_ROWS - 1) };
  });
  return { ...state, ghosts };
}

// A ghost touching the player resets the player to the origin corner — no score penalty and
// no "game over": DEX CONTINUATION MASTER DIRECTIVE requires the game stay low-stakes and
// never affect the real audit, and a harsh fail state would work against "while I wait" framing.
export function checkGhostCollision(state: CrawlRunnerState): CrawlRunnerState {
  const hit = state.ghosts.some((g) => g.x === state.player.x && g.y === state.player.y);
  if (!hit) return state;
  return { ...state, player: { x: 0, y: 0 } };
}
