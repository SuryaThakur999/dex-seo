import { describe, it, expect } from 'vitest';
import { computeDecorativeTiles, computeSitemapBridges } from './index-quest-theme';
import { GRID_COLS, GRID_ROWS } from './crawl-runner-engine';

describe('computeDecorativeTiles', () => {
  it('is fully deterministic for the real grid dimensions', () => {
    expect(computeDecorativeTiles(GRID_COLS, GRID_ROWS)).toEqual(computeDecorativeTiles(GRID_COLS, GRID_ROWS));
  });

  it('places every tile within the real grid bounds', () => {
    const tiles = computeDecorativeTiles(GRID_COLS, GRID_ROWS);
    for (const tile of tiles) {
      expect(tile.cell.x).toBeGreaterThanOrEqual(0);
      expect(tile.cell.x).toBeLessThan(GRID_COLS);
      expect(tile.cell.y).toBeGreaterThanOrEqual(0);
      expect(tile.cell.y).toBeLessThan(GRID_ROWS);
    }
  });

  it('includes all four documented tile kinds', () => {
    const kinds = new Set(computeDecorativeTiles(GRID_COLS, GRID_ROWS).map((t) => t.kind));
    expect(kinds).toEqual(new Set(['canonical-gate', 'schema-elevator', 'broken-link-gap', 'redirect-portal']));
  });
});

describe('computeSitemapBridges', () => {
  it('returns bridges with both endpoints inside the real grid bounds', () => {
    const bridges = computeSitemapBridges(GRID_COLS, GRID_ROWS);
    for (const [a, b] of bridges) {
      for (const cell of [a, b]) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(GRID_COLS);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(GRID_ROWS);
      }
    }
  });
});
