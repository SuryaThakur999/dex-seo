import type { Cell } from './crawl-runner-engine';

// Purely decorative Index Quest level dressing — computed deterministically from the grid
// dimensions, never randomized and never touching CrawlRunnerState. These tiles carry zero
// gameplay effect: no collision, no scoring, nothing here can move, block, or otherwise
// influence the verified game engine in crawl-runner-engine.ts. Original concepts only —
// "canonical gate," "schema elevator," "broken-link gap," and "redirect portal" are Dex's own
// SEO-flavored naming for plain decorative tile glyphs, not a borrowed level design.
export type DecorativeTileKind = 'canonical-gate' | 'schema-elevator' | 'broken-link-gap' | 'redirect-portal';

export interface DecorativeTile {
  cell: Cell;
  kind: DecorativeTileKind;
}

export function computeDecorativeTiles(cols: number, rows: number): DecorativeTile[] {
  return [
    { cell: { x: 0, y: 0 }, kind: 'canonical-gate' },
    { cell: { x: cols - 1, y: 0 }, kind: 'canonical-gate' },
    { cell: { x: 0, y: rows - 1 }, kind: 'canonical-gate' },
    { cell: { x: cols - 1, y: rows - 1 }, kind: 'canonical-gate' },
    { cell: { x: Math.floor(cols / 2), y: Math.floor(rows / 2) }, kind: 'schema-elevator' },
    { cell: { x: 2, y: 2 }, kind: 'broken-link-gap' },
    { cell: { x: cols - 3, y: rows - 3 }, kind: 'redirect-portal' },
  ];
}

// "Sitemap bridges" — fixed dashed connector lines between anchor points, purely visual.
export function computeSitemapBridges(cols: number, rows: number): [Cell, Cell][] {
  return [
    [
      { x: 1, y: Math.floor(rows / 2) },
      { x: cols - 2, y: Math.floor(rows / 2) },
    ],
    [
      { x: Math.floor(cols / 2), y: 1 },
      { x: Math.floor(cols / 2), y: rows - 2 },
    ],
  ];
}
