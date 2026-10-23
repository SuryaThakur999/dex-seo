import type { Direction } from './crawl-runner-engine';

// Dex Signal — Dex's own original mascot. A rounded body with three nested signal-wave arcs
// (echoing "Dex Signal" and the product's detection/audit theme) and two dot eyes. Built
// entirely from canvas primitives (arcs, rounded rects) — no image asset, no borrowed
// character design, shape, palette, or sound from any existing property. One consistent
// design expressed in two renderers: this canvas drawer (game states) and DexSignalMark (the
// SVG sidebar/avatar mark) — same body proportions, arc motif, and eye placement in both.
export type DexSignalPose = 'idle' | 'hop' | 'collect' | 'complete';

// Per the written visual contract: "coral-orange floating scanner, black face, cream eyes,
// mint signal antenna."
const BODY_FILL = '#ff7a1a'; // coral-orange — same hex the game's player square already used.
const FACE_FILL = '#14100c'; // black face plate, matches the game canvas's own ink.
const EYE_FILL = '#fff9ec'; // cream eyes.
const ANTENNA_MINT = '#3ddc97'; // mint signal antenna — Dex's success mint, same as the signal orbs.
const ANTENNA_DIM = 'rgba(61,220,151,0.35)';

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws one frame of Dex Signal at grid cell center (cx, cy), sized to fit a `size`×`size`
 * cell. `frame` is a monotonically increasing tick counter driving the idle arc pulse — purely
 * cosmetic, has no effect on `crawl-runner-engine.ts`'s state.
 */
export function drawDexSignal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  pose: DexSignalPose,
  direction: Direction | null,
  frame: number
) {
  const scale = pose === 'hop' ? 1.2 : pose === 'collect' ? 1.1 : 1;
  const lean = direction === 'left' ? -0.14 : direction === 'right' ? 0.14 : 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.rotate(lean);

  const r = size / 2 - 3;

  // Body — coral-orange floating scanner.
  ctx.fillStyle = BODY_FILL;
  roundRectPath(ctx, -r, -r, r * 2, r * 2, 6);
  ctx.fill();

  // Black face plate — sized to contain the outermost antenna arc's peak (~1-2px margin,
  // an Agent B review caught the previous shorter plate clipping it onto the orange body).
  ctx.fillStyle = FACE_FILL;
  roundRectPath(ctx, -r + 2, -r + 3, r * 2 - 4, r * 1.6, 4);
  ctx.fill();

  // Mint signal antenna — three nested arcs, one highlighted per idle pulse tick.
  const pulseIndex = Math.floor(frame / 4) % 3;
  for (let i = 0; i < 3; i++) {
    const active = pose === 'complete' || i === pulseIndex;
    ctx.strokeStyle = active ? ANTENNA_MINT : ANTENNA_DIM;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 2, 3 + i * 3.5, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }

  // Cream eyes.
  ctx.fillStyle = EYE_FILL;
  ctx.beginPath();
  ctx.arc(-3.5, -2, 1.4, 0, Math.PI * 2);
  ctx.arc(3.5, -2, 1.4, 0, Math.PI * 2);
  ctx.fill();

  if (pose === 'collect') {
    ctx.strokeStyle = ANTENNA_MINT;
    ctx.lineWidth = 1.5;
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (r + 1), Math.sin(angle) * (r + 1));
      ctx.lineTo(Math.cos(angle) * (r + 7), Math.sin(angle) * (r + 7));
      ctx.stroke();
    }
  }

  if (pose === 'complete') {
    ctx.strokeStyle = ANTENNA_MINT;
    ctx.lineWidth = 1;
    for (let a = 0; a < 10; a++) {
      const angle = (a / 10) * Math.PI * 2;
      const dist = r + 6 + (a % 2) * 3;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * dist, Math.sin(angle) * dist, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
