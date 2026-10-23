'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X, Pause, Play } from '@phosphor-icons/react';
import { useReducedMotion } from 'motion/react';
import {
  createInitialState,
  movePlayer,
  stepGhosts,
  checkGhostCollision,
  GRID_COLS,
  GRID_ROWS,
  type CrawlRunnerState,
  type Direction,
} from '@/lib/crawl-runner-engine';
import { computeDecorativeTiles, computeSitemapBridges, type DecorativeTileKind } from '@/lib/index-quest-theme';
import { drawDexSignal, type DexSignalPose } from '@/lib/dex-signal-sprite';

const CELL_PX = 28;
const GHOST_TICK_MS = 700;

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

// Index Quest's decorative level dressing — same tiles/bridges every game (see
// index-quest-theme.ts), computed once since they never change with gameplay.
const DECORATIVE_TILES = computeDecorativeTiles(GRID_COLS, GRID_ROWS);
const SITEMAP_BRIDGES = computeSitemapBridges(GRID_COLS, GRID_ROWS);

function cellCenter(x: number, y: number): [number, number] {
  return [x * CELL_PX + CELL_PX / 2, y * CELL_PX + CELL_PX / 2];
}

function drawDecorativeTile(ctx: CanvasRenderingContext2D, x: number, y: number, kind: DecorativeTileKind) {
  const [cx, cy] = cellCenter(x, y);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1.5;
  switch (kind) {
    case 'canonical-gate': {
      // A small bracket "gateway" glyph framing the corner.
      const s = CELL_PX / 2 - 4;
      ctx.beginPath();
      ctx.moveTo(-s, -s + 4);
      ctx.lineTo(-s, -s);
      ctx.lineTo(-s + 4, -s);
      ctx.moveTo(s - 4, s);
      ctx.lineTo(s, s);
      ctx.lineTo(s, s - 4);
      ctx.stroke();
      break;
    }
    case 'schema-elevator': {
      // Up/down chevrons — a purely decorative "elevator" glyph.
      ctx.beginPath();
      ctx.moveTo(-4, -1);
      ctx.lineTo(0, -5);
      ctx.lineTo(4, -1);
      ctx.moveTo(-4, 5);
      ctx.lineTo(0, 1);
      ctx.lineTo(4, 5);
      ctx.stroke();
      break;
    }
    case 'broken-link-gap': {
      ctx.strokeStyle = 'rgba(224,90,78,0.35)';
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(4, 4);
      ctx.moveTo(4, -4);
      ctx.lineTo(-4, 4);
      ctx.stroke();
      break;
    }
    case 'redirect-portal': {
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0.3, Math.PI * 1.6);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, state: CrawlRunnerState, pose: DexSignalPose, direction: Direction | null, frame: number) {
  const width = GRID_COLS * CELL_PX;
  const height = GRID_ROWS * CELL_PX;
  ctx.fillStyle = '#14100c';
  ctx.fillRect(0, 0, width, height);

  // URL platforms — the grid itself, each cell one addressable "page."
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let x = 0; x <= GRID_COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL_PX, 0);
    ctx.lineTo(x * CELL_PX, height);
    ctx.stroke();
  }
  for (let y = 0; y <= GRID_ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL_PX);
    ctx.lineTo(width, y * CELL_PX);
    ctx.stroke();
  }

  // Sitemap bridges — fixed dashed connectors, purely decorative.
  ctx.strokeStyle = 'rgba(255,150,90,0.18)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  for (const [a, b] of SITEMAP_BRIDGES) {
    const [ax, ay] = cellCenter(a.x, a.y);
    const [bx, by] = cellCenter(b.x, b.y);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const tile of DECORATIVE_TILES) drawDecorativeTile(ctx, tile.cell.x, tile.cell.y, tile.kind);

  // Mint signal orbs.
  ctx.fillStyle = '#3ddc97';
  for (const orb of state.orbs) {
    const [ox, oy] = cellCenter(orb.x, orb.y);
    ctx.beginPath();
    ctx.arc(ox, oy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 404 ghosts — original shape (rounded blob + two eyes), not a licensed character.
  ctx.fillStyle = '#e05a4e';
  for (const ghost of state.ghosts) {
    const cx = ghost.x * CELL_PX + CELL_PX / 2;
    const cy = ghost.y * CELL_PX + CELL_PX / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL_PX / 2 - 5, Math.PI, 0);
    ctx.lineTo(cx + CELL_PX / 2 - 5, cy + CELL_PX / 2 - 6);
    ctx.lineTo(cx, cy + CELL_PX / 2 - 10);
    ctx.lineTo(cx - CELL_PX / 2 + 5, cy + CELL_PX / 2 - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#14100c';
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 3, 1.6, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy - 3, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e05a4e';
  }

  // Player — Dex Signal, the app's own mascot (see dex-signal-sprite.ts).
  const [px, py] = cellCenter(state.player.x, state.player.y);
  drawDexSignal(ctx, px, py, CELL_PX, pose, direction, frame);
}

export function CrawlRunner({ onExit }: { onExit: () => void }) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CrawlRunnerState>(createInitialState());
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted] = useState(true); // sound off by default, no audio assets exist to unmute to
  // Agent B finding: the canvas's static aria-label never updated after mount, leaving the
  // game silent to screen-reader users. This is the live announcement channel instead.
  const [statusMessage, setStatusMessage] = useState('Crawl Runner started. Arcade score 0.');

  // Dex Signal's transient pose — purely cosmetic (see dex-signal-sprite.ts), never read by
  // crawl-runner-engine.ts. `frameRef` drives the idle arc pulse and only ever increments.
  const poseRef = useRef<DexSignalPose>('idle');
  const directionRef = useRef<Direction | null>(null);
  const frameRef = useRef(0);
  const poseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    frameRef.current += 1;
    draw(ctx, stateRef.current, poseRef.current, directionRef.current, frameRef.current);
  }, []);

  const setTransientPose = useCallback((pose: DexSignalPose, ms: number) => {
    poseRef.current = pose;
    if (poseTimeoutRef.current) clearTimeout(poseTimeoutRef.current);
    poseTimeoutRef.current = setTimeout(() => {
      poseRef.current = 'idle';
    }, ms);
  }, []);

  useEffect(
    () => () => {
      if (poseTimeoutRef.current) clearTimeout(poseTimeoutRef.current);
    },
    []
  );

  const move = useCallback(
    (direction: Direction) => {
      if (paused) return;
      const before = stateRef.current;
      const moved = movePlayer(before, direction);
      const collected = moved.score > before.score;
      const after = checkGhostCollision(moved);
      const hitGhost = after.player.x !== moved.player.x || after.player.y !== moved.player.y;
      stateRef.current = after;
      setScore(after.score);
      directionRef.current = direction;
      // Reduced motion keeps a single static frame instead of the hop/burst pop — the
      // underlying game state change is identical either way, only the sprite pose differs.
      if (!reduce) setTransientPose(collected ? 'collect' : 'hop', collected ? 500 : 220);
      if (hitGhost) setStatusMessage('Caught by a 404 ghost. Back to start.');
      else if (collected) setStatusMessage(`Signal orb collected. Arcade score ${after.score}.`);
      redraw();
    },
    [paused, reduce, redraw, setTransientPose]
  );

  // Ghost movement is the only thing on a timer — DEX CONTINUATION MASTER DIRECTIVE: "no AI or
  // API calls for gameplay" and "pause when the tab becomes hidden." A slower tick under
  // reduced motion keeps the game playable without relying on fast visual tracking.
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(
      () => {
        if (document.visibilityState === 'hidden') return;
        stateRef.current = checkGhostCollision(stepGhosts(stateRef.current));
        redraw();
      },
      reduce ? GHOST_TICK_MS * 2 : GHOST_TICK_MS
    );
    return () => clearInterval(interval);
  }, [paused, reduce, redraw]);

  useEffect(() => {
    function onVisibilityChange() {
      setPaused(document.visibilityState === 'hidden');
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Agent B finding: a window-level listener hijacked arrow keys page-wide (including a
  // screen reader's own virtual-cursor arrow navigation) for as long as the panel was
  // mounted. Scoped to this container's own onKeyDown instead — only fires while focus is
  // actually inside the game.
  function handleContainerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const direction = KEY_TO_DIRECTION[e.key];
    if (!direction) return;
    e.preventDefault();
    move(direction);
  }

  // Agent B finding: launching the game moved nothing into it for keyboard/AT focus.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleContainerKeyDown}
      role="application"
      aria-label="Crawl Runner game"
      className="flex flex-col gap-2 rounded-md border border-border bg-[var(--dex-app-bg-elevated-2)] p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-accent">Crawl Runner</span>
          <span className="text-xs text-muted-foreground">Arcade score {score}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground" aria-live="off">
            {muted ? 'Sound off' : ''}
          </span>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Resume game' : 'Pause game'}
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {paused ? <Play size={16} weight="regular" /> : <Pause size={16} weight="regular" />}
          </button>
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit game"
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} weight="regular" />
          </button>
        </div>
      </div>

      {/* Visually hidden, screen-reader-only live status — the canvas itself is a static
          role="img" that never updates; this is what actually announces gameplay changes. */}
      <p className="sr-only" aria-live="polite" role="status">
        {statusMessage}
      </p>

      <canvas
        ref={canvasRef}
        width={GRID_COLS * CELL_PX}
        height={GRID_ROWS * CELL_PX}
        role="img"
        aria-label={`Crawl Runner game grid. Arcade score ${score}.`}
        className="max-w-full self-center rounded"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-muted-foreground">Arrow keys or WASD to move · Touch to play on mobile</p>
        <div className="grid w-32 grid-cols-3 grid-rows-2 gap-1">
          <div />
          <button
            type="button"
            onClick={() => move('up')}
            aria-label="Move up"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-foreground active:bg-muted"
          >
            ↑
          </button>
          <div />
          <button
            type="button"
            onClick={() => move('left')}
            aria-label="Move left"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-foreground active:bg-muted"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => move('down')}
            aria-label="Move down"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-foreground active:bg-muted"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => move('right')}
            aria-label="Move right"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-foreground active:bg-muted"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
