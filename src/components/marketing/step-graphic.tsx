'use client';

import { motion, useReducedMotion } from 'motion/react';

export type StepKind = 'scan' | 'flag' | 'draft' | 'review';

// Small live diagrams for the four How-it-works steps. Each one rests in a calm state and plays
// its step when `active` (card hovered, or scrolled into view on touch screens). Springs are
// critically damped so nothing wobbles; only transform, opacity, colour and width animate.
const SPRING = { type: 'spring', bounce: 0, duration: 0.5 } as const;
const ROWS = [0, 1, 2, 3];

export function StepGraphic({ kind, active }: { kind: StepKind; active: boolean }) {
  const reduce = useReducedMotion();
  const on = active && !reduce;

  return (
    <div
      aria-hidden="true"
      className="relative h-28 overflow-hidden rounded-2xl border border-[var(--dex-border)] bg-[var(--dex-bg)] p-4"
    >
      {kind === 'scan' && <Scan on={on} />}
      {kind === 'flag' && <Flag on={on} />}
      {kind === 'draft' && <Draft on={on} />}
      {kind === 'review' && <Review on={on} done={active} />}
    </div>
  );
}

// Pages stacked like a sitemap; a light bar sweeps down and each page lights up as it is read.
function Scan({ on }: { on: boolean }) {
  return (
    <>
      <div className="flex h-full flex-col justify-between">
        {ROWS.map((i) => (
          <motion.div
            key={i}
            className="h-3 rounded-full"
            style={{ width: `${88 - i * 14}%` }}
            initial={{ backgroundColor: "#1d1d24" }}
            animate={{ backgroundColor: on ? ['#1d1d24', 'rgba(255,77,46,0.55)', '#2f2f38'] : '#1d1d24' }}
            transition={
              on
                ? { duration: 1.4, times: [0, 0.25, 1], delay: 0.15 + i * 0.3, repeat: Infinity, repeatDelay: 0.8 }
                : { duration: 0.3 }
            }
          />
        ))}
      </div>
      <motion.div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--dex-accent)] shadow-[0_0_12px_2px_rgba(255,77,46,0.6)]"
        initial={{ y: -4, opacity: 0 }}
        animate={on ? { y: [8, 104], opacity: [0, 1, 1, 0] } : { y: -4, opacity: 0 }}
        transition={on ? { duration: 1.4, ease: 'linear', repeat: Infinity, repeatDelay: 0.8 } : SPRING}
      />
    </>
  );
}

// A list of page checks; two rows get flagged red.
function Flag({ on }: { on: boolean }) {
  const flagged = new Set([1, 3]);
  return (
    <div className="flex h-full flex-col justify-between">
      {ROWS.map((i) => (
        <div key={i} className="flex items-center gap-2">
          <motion.span
            className="size-2.5 shrink-0 rounded-full"
            animate={{
              backgroundColor: on && flagged.has(i) ? '#ff6b5e' : '#2a2a32',
              scale: on && flagged.has(i) ? 1.25 : 1,
            }}
            transition={{ ...SPRING, delay: on ? 0.15 + i * 0.12 : 0 }}
          />
          <div className="h-2.5 flex-1 rounded-full bg-[var(--dex-bg-elevated-2)]" style={{ maxWidth: `${70 + (i % 2) * 20}%` }} />
          <motion.span
            className="rounded-full border border-[#ff6b5e]/40 px-1.5 text-[0.625rem] font-semibold text-[#ff6b5e]"
            animate={{ opacity: on && flagged.has(i) ? 1 : 0, x: on && flagged.has(i) ? 0 : 6 }}
            transition={{ ...SPRING, delay: on ? 0.25 + i * 0.12 : 0 }}
          >
            fix
          </motion.span>
        </div>
      ))}
    </div>
  );
}

// Lines of a draft write themselves out.
function Draft({ on }: { on: boolean }) {
  const widths = [92, 78, 86, 54];
  return (
    <div className="flex h-full flex-col justify-between">
      {widths.map((w, i) => (
        <div key={i} className="h-2.5 rounded-full bg-[var(--dex-bg-elevated-2)]">
          <motion.div
            className="h-full rounded-full bg-[var(--dex-accent-secondary)]/80"
            initial={{ width: '0%' }}
            animate={{ width: on ? `${w}%` : '0%' }}
            transition={on ? { duration: 0.45, ease: [0.23, 1, 0.32, 1], delay: i * 0.35 } : { duration: 0.2 }}
          />
        </div>
      ))}
    </div>
  );
}

// Five safety checks fill in one by one, then the draft waits for the owner's yes.
function Review({ on, done }: { on: boolean; done: boolean }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.span
            key={i}
            className="flex size-6 items-center justify-center rounded-full border text-[0.6875rem] font-bold"
            animate={{
              backgroundColor: done ? '#3ddc97' : 'rgba(0,0,0,0)',
              borderColor: done ? '#3ddc97' : '#2a2a32',
              color: done ? '#0b0b0f' : '#5a5a66',
              scale: on ? [1, 1.15, 1] : 1,
            }}
            transition={{ duration: 0.35, delay: on ? i * 0.14 : 0 }}
          >
            ✓
          </motion.span>
        ))}
      </div>
      <motion.div
        className="flex items-center justify-between rounded-full border px-3 py-1.5 text-[0.75rem]"
        animate={{ borderColor: done ? 'rgba(255,77,46,0.6)' : '#232329' }}
        transition={{ ...SPRING, delay: on ? 0.8 : 0 }}
      >
        <span className="text-[var(--dex-text-secondary)]">{done ? 'Waiting for your yes' : 'Checks pending'}</span>
        <motion.span
          className="rounded-full bg-[var(--dex-accent)] px-2 py-0.5 font-semibold text-white"
          animate={{ opacity: done ? 1 : 0.3 }}
          transition={{ ...SPRING, delay: on ? 0.8 : 0 }}
        >
          Approve
        </motion.span>
      </motion.div>
    </div>
  );
}
