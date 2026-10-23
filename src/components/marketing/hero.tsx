'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
import { Waves } from '@/components/ui/wave-background';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';
import { ThinkingOrb } from 'thinking-orbs';

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  // Three layers move at different rates as the hero scrolls past, so the exit reads as
  // real depth rather than a flat block sliding off screen: the wave drifts the most (it's
  // "furthest back"), the glow drifts less, the copy barely moves (it's "closest").
  const waveY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [0, 220]);
  const waveOpacity = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1, 0.15]);
  const glowY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [0, 90]);
  const glowScale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [1, 1.4]);
  const contentY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [0, 60]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.8], reduce ? [1, 1] : [1, 0]);

  return (
    <section ref={sectionRef} className="relative min-h-[100dvh] w-full overflow-hidden bg-[var(--dex-bg)]">
      <motion.div style={{ y: waveY, opacity: waveOpacity }} className="absolute inset-0">
        <Waves strokeColor="#2a2033" backgroundColor="transparent" pointerSize={0.5} />
      </motion.div>

      <motion.div
        aria-hidden="true"
        style={{ y: glowY, scale: glowScale }}
        className="pointer-events-none absolute left-1/2 top-1/3 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-[110px]"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            background: 'radial-gradient(circle, var(--dex-accent) 0%, var(--dex-accent-secondary) 55%, transparent 75%)',
          }}
        />
      </motion.div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--dex-bg)] via-transparent to-[var(--dex-bg)]" />

      <motion.div
        style={{ y: contentY, opacity: contentOpacity }}
        className="relative z-10 mx-auto flex min-h-[100dvh] max-w-5xl flex-col items-center justify-center px-4 pt-16 text-center"
      >
        <motion.span
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="dex-label mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--dex-border)] bg-[var(--dex-bg-elevated)] px-4 py-1.5 text-[var(--dex-text-secondary)]"
        >
          <ThinkingOrb state="searching" size={20} theme="dark" paused={reduce ?? false} aria-hidden="true" />
          Your AI marketing team, supervised
        </motion.span>

        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
          className="text-balance text-[clamp(2.75rem,7vw,5.75rem)] font-bold leading-[1.05] tracking-tight text-[var(--dex-text-primary)]"
        >
          The pages that need help most are the ones you{' '}
          <span className="text-[var(--dex-accent-secondary)]">never</span> check.
        </motion.h1>
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className="dex-lead mt-7"
        >
          Dex finds them anyway. It drafts the fix, then waits for you to say yes.
        </motion.p>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto mt-10 flex flex-col items-center gap-4 sm:flex-row"
        >
          {/* The site address rides along to sign-up so the audit can start from it. */}
          <form action="/sign-up" method="get" className="flex w-full max-w-md items-center gap-2 rounded-full border border-[var(--dex-border)] bg-[var(--dex-bg-elevated)] p-1.5 pl-5 transition-colors focus-within:border-[var(--dex-border-accent)]">
            <label htmlFor="hero-site" className="sr-only">Your website address</label>
            <input
              id="hero-site"
              name="site"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="yoursite.de"
              className="min-w-0 flex-1 bg-transparent text-base text-[var(--dex-text-primary)] placeholder:text-[var(--dex-text-tertiary)] focus:outline-none"
            />
            <HoverBorderGradient
              as="button"
              {...({ type: 'submit' } as React.ButtonHTMLAttributes<HTMLButtonElement>)}
              containerClassName="rounded-full shrink-0"
              className="dex-press rounded-full bg-[var(--dex-accent)] px-6 py-3 text-[0.9375rem] font-bold text-white"
            >
              Start my audit
            </HoverBorderGradient>
          </form>
          <a
            href="#how"
            className="group flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.9375rem] text-[var(--dex-text-secondary)] transition-colors hover:text-[var(--dex-accent)]"
          >
            See how it works
            <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
          </a>
        </motion.div>
        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5 text-[0.8125rem] text-[var(--dex-text-secondary)]"
        >
          Free to start. Dex only reads public pages and never logs in to your website.
        </motion.p>
      </motion.div>

      <motion.div
        aria-hidden="true"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.8 }}
        style={{ opacity: reduce ? 1 : contentOpacity }}
        className="absolute inset-x-0 bottom-8 z-10 flex justify-center"
      >
        <span className="h-9 w-5 rounded-full border border-[var(--dex-border)]">
          <motion.span
            animate={reduce ? {} : { y: [2, 14, 2] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            className="mx-auto mt-1.5 block h-1.5 w-1.5 rounded-full bg-[var(--dex-accent-secondary)]"
          />
        </span>
      </motion.div>
    </section>
  );
}
