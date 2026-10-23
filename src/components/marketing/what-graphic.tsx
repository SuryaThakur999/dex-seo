'use client';

import { motion, useReducedMotion } from 'motion/react';

export type WhatKind = 'checks' | 'search' | 'voice' | 'log';

// Live previews for the What-you-get cards. Different motifs from How it works: a checklist
// that catches a mistake, a search result that fills in, copy that rewrites itself into your
// voice, and a decision log that writes itself. Each rests calm and plays when `active`.
const EASE = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: 'spring', bounce: 0, duration: 0.45 } as const;

export function WhatGraphic({ kind, active }: { kind: WhatKind; active: boolean }) {
  const reduce = useReducedMotion();
  const on = active && !reduce;
  return (
    <div
      aria-hidden="true"
      className="relative h-40 overflow-hidden rounded-2xl border border-[var(--dex-border)] bg-[var(--dex-bg)] p-4 text-[0.75rem]"
    >
      {kind === 'checks' && <Checks on={on} done={active} />}
      {kind === 'search' && <Search on={on} done={active} />}
      {kind === 'voice' && <Voice on={on} done={active} />}
      {kind === 'log' && <Log on={on} done={active} />}
    </div>
  );
}

// Five named checks tick in; one catches a problem and the draft is held, not approved.
function Checks({ on, done }: { on: boolean; done: boolean }) {
  const checks = ['AI label added', 'Every claim backed', 'Matches your copy', 'Right length', 'Not a duplicate'];
  const caught = 1;
  return (
    <ul className="flex h-full flex-col justify-between">
      {checks.map((c, i) => {
        const bad = i === caught;
        return (
          <li key={c} className="flex items-center justify-between gap-3">
            <span className="text-[var(--dex-text-secondary)]">{c}</span>
            <motion.span
              className="rounded-full px-2 py-0.5 font-semibold"
              initial={false}
              animate={{
                opacity: done ? 1 : 0.25,
                scale: on ? [0.6, 1.1, 1] : 1,
                backgroundColor: done ? (bad ? 'rgba(255,107,94,0.15)' : 'rgba(61,220,151,0.15)') : 'rgba(0,0,0,0)',
                color: done ? (bad ? '#ff6b5e' : '#3ddc97') : '#5a5a66',
              }}
              transition={{ duration: 0.4, ease: EASE, delay: on ? 0.1 + i * 0.16 : 0 }}
            >
              {done ? (bad ? 'held' : 'pass') : '...'}
            </motion.span>
          </li>
        );
      })}
    </ul>
  );
}

// A search result goes from half-empty to complete: title, address and a real description.
function Search({ on, done }: { on: boolean; done: boolean }) {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center gap-2">
        <span className="size-4 rounded-full bg-[var(--dex-accent)]" />
        <span className="text-[var(--dex-text-tertiary)]">yoursite.com</span>
      </div>
      <motion.p
        className="text-[0.9375rem] font-semibold"
        initial={false}
        animate={{ color: done ? '#8ab4f8' : '#5a5a66' }}
        transition={{ ...SPRING, delay: on ? 0.1 : 0 }}
      >
        {done ? 'Your page, with a title people click' : 'Untitled page'}
      </motion.p>
      {[100, 82].map((w, i) => (
        <div key={w} className="h-2.5 rounded-full bg-[var(--dex-bg-elevated-2)]">
          <motion.div
            className="h-full rounded-full bg-[#c4c4cc]/70"
            initial={false}
            animate={{ width: done ? `${w}%` : '0%' }}
            transition={on ? { duration: 0.5, ease: EASE, delay: 0.3 + i * 0.25 } : { duration: 0.2 }}
          />
        </div>
      ))}
      <motion.div
        className="mt-1 flex gap-2"
        initial={false}
        animate={{ opacity: done ? 1 : 0, y: done ? 0 : 6 }}
        transition={{ ...SPRING, delay: on ? 0.9 : 0 }}
      >
        <span className="rounded-full border border-[var(--dex-border)] px-2 py-0.5 text-[var(--dex-text-secondary)]">Google</span>
        <span className="rounded-full border border-[var(--dex-border)] px-2 py-0.5 text-[var(--dex-text-secondary)]">ChatGPT</span>
      </motion.div>
    </div>
  );
}

// Generic template copy is struck out and replaced by a line in the owner's own voice.
function Voice({ on, done }: { on: boolean; done: boolean }) {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="relative w-fit">
        <motion.p
          className="text-[0.875rem]"
          initial={false}
          animate={{ color: done ? '#5a5a66' : '#9a9aa5' }}
          transition={{ duration: 0.3 }}
        >
          We offer innovative solutions for all your needs.
        </motion.p>
        <motion.span
          className="absolute left-0 top-1/2 h-px bg-[#ff6b5e]"
          initial={false}
          animate={{ width: done ? '100%' : '0%' }}
          transition={on ? { duration: 0.4, ease: EASE, delay: 0.15 } : { duration: 0.2 }}
        />
      </div>
      <motion.p
        className="text-[0.9375rem] font-medium text-[var(--dex-text-primary)]"
        initial={false}
        animate={{ opacity: done ? 1 : 0, x: done ? 0 : -10 }}
        transition={{ ...SPRING, delay: on ? 0.55 : 0 }}
      >
        Fresh bread from 6am, baked in our shop around the corner.
      </motion.p>
      <motion.span
        className="w-fit rounded-full bg-[var(--dex-accent-secondary)]/15 px-2 py-0.5 font-semibold text-[var(--dex-accent-secondary)]"
        initial={false}
        animate={{ opacity: done ? 1 : 0 }}
        transition={{ ...SPRING, delay: on ? 0.8 : 0 }}
      >
        In your brand voice
      </motion.span>
    </div>
  );
}

// The decision log writes itself, newest entry last.
function Log({ on, done }: { on: boolean; done: boolean }) {
  const rows = [
    { what: 'Draft written', who: 'Dex' },
    { what: '5 checks passed', who: 'Dex' },
    { what: 'Edited the title', who: 'You' },
    { what: 'Approved', who: 'You' },
  ];
  return (
    <ol className="relative flex h-full flex-col justify-between border-l border-[var(--dex-border)] pl-4">
      {rows.map((r, i) => (
        <motion.li
          key={r.what}
          className="relative flex items-center justify-between gap-3"
          initial={false}
          animate={{ opacity: done ? 1 : 0.25, x: done ? 0 : -6 }}
          transition={{ ...SPRING, delay: on ? i * 0.18 : 0 }}
        >
          <span className="absolute -left-[1.3rem] size-2 rounded-full bg-[var(--dex-accent)]" />
          <span className="text-[var(--dex-text-primary)]">{r.what}</span>
          <span className="font-mono text-[var(--dex-text-tertiary)]">{r.who}</span>
        </motion.li>
      ))}
    </ol>
  );
}
