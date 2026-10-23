'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { MagnifyingGlass, Flag, PenNib, CheckCircle } from '@phosphor-icons/react/dist/ssr';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { StepGraphic, type StepKind } from '@/components/marketing/step-graphic';

const STEPS = [
  {
    number: '01',
    title: 'Scan',
    graphic: 'scan' as StepKind,
    orb: 'searching' as OrbState,
    icon: MagnifyingGlass,
    body: 'Reads every page on your sitemap, even the ones nobody has visited in months.',
    hint: 'Includes pages Search Console can’t see',
  },
  {
    number: '02',
    title: 'Flag',
    graphic: 'flag' as StepKind,
    orb: 'solving' as OrbState,
    icon: Flag,
    body: 'Finds what holds your pages back: missing descriptions, duplicate titles, thin content.',
    hint: 'Five checks, not a guess',
  },
  {
    number: '03',
    title: 'Draft',
    graphic: 'draft' as StepKind,
    orb: 'composing' as OrbState,
    icon: PenNib,
    body: 'Writes the fix in your words, so you never start from a blank page.',
    hint: 'Grounded in your existing copy',
  },
  {
    number: '04',
    title: 'Review',
    graphic: 'review' as StepKind,
    orb: 'breathing' as OrbState,
    icon: CheckCircle,
    body: 'Runs five safety checks, then waits for you. You stay the boss.',
    hint: 'Nothing publishes without you',
  },
];

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.14, delayChildren: 0.05 },
  },
};

// Cards alternate their entrance direction and settle-rotation left/right
// down the row, so the grid reads as four distinct arrivals rather than
// one fade replayed four times.
function cardVariants(index: number): Variants {
  const fromLeft = index % 2 === 0;
  return {
    hidden: {
      opacity: 0,
      y: 28,
      x: fromLeft ? -22 : 22,
      scale: 0.92,
      rotate: fromLeft ? -3 : 3,
    },
    visible: {
      opacity: 1,
      y: 0,
      x: 0,
      scale: 1,
      rotate: 0,
      transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
    },
  };
}

export function HowSection() {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  // Touch screens have no hover, so each diagram plays once its card scrolls into view.
  const [coarse, setCoarse] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    setCoarse(window.matchMedia('(hover: none)').matches);
  }, []);

  return (
    <section
      id="how"
      className="dex-section w-full overflow-x-hidden border-y border-[var(--dex-border)] bg-[var(--dex-bg)]"
    >
      <div className="mx-auto max-w-6xl">
        <h2 className="dex-h2 max-w-3xl">
          It does the looking. You do the deciding.
        </h2>
        <p className="dex-lead mt-6">Four steps. Dex does the first three on its own. The last one is yours, and it takes one click.</p>

        <motion.div
          initial={reduce ? undefined : 'hidden'}
          whileInView={reduce ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.3 }}
          variants={reduce ? undefined : containerVariants}
          className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {STEPS.map((step, i) => {
            const isAmber = i % 2 === 1;
            const accentVar = isAmber ? 'var(--dex-accent-secondary)' : 'var(--dex-accent)';
            const isHovered = hovered === i;

            return (
              <motion.div
                key={step.title}
                variants={reduce ? undefined : cardVariants(i)}
                onViewportEnter={() => {
                  if (coarse) setSeen((prev) => new Set(prev).add(i));
                }}
                viewport={{ once: true, amount: 0.6 }}
                onHoverStart={() => setHovered(i)}
                onHoverEnd={() => setHovered((current) => (current === i ? null : current))}
                whileHover={
                  reduce
                    ? undefined
                    : {
                        y: -8,
                        boxShadow: '0 24px 48px -20px rgba(255, 77, 46, 0.35)',
                        transition: { type: 'spring', stiffness: 300, damping: 22 },
                      }
                }
                className="min-h-[17rem] rounded-3xl border border-[var(--dex-border)] bg-[var(--dex-bg-elevated)] p-7 transition-colors duration-300 hover:border-[var(--dex-border-accent)] md:p-8"
              >
                <div className="flex items-start justify-between">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <motion.span
                        animate={
                          reduce
                            ? undefined
                            : {
                                scale: isHovered ? 1.14 : 1,
                                rotate: isHovered ? (fromLeftRotate(i)) : 0,
                              }
                        }
                        transition={{ type: 'spring', stiffness: 320, damping: 14 }}
                        style={{ color: accentVar }}
                        className="inline-flex cursor-default"
                      >
                        <step.icon size={32} weight="light" />
                      </motion.span>
                    </TooltipTrigger>
                    <TooltipContent className="border border-[#232329] bg-[#1d1d24] text-[#f4f4f6]">
                      {step.hint}
                    </TooltipContent>
                  </Tooltip>
                  <span className="flex items-center gap-2 font-mono text-[0.8125rem] tracking-wider text-[var(--dex-text-tertiary)]">
                    {/* The step's agent state, shown only while the card is hovered so the grid stays calm. */}
                    <span
                      aria-hidden="true"
                      className="inline-flex transition-opacity duration-200 ease-out"
                      style={{ opacity: isHovered && !reduce ? 1 : 0 }}
                    >
                      <ThinkingOrb state={step.orb} size={20} theme="dark" paused={!isHovered || (reduce ?? false)} />
                    </span>
                    {step.number}
                  </span>
                </div>
                <div className="mt-5">
                  <StepGraphic kind={step.graphic} active={isHovered || seen.has(i)} />
                </div>
                <h3 className="dex-h3 dex-h3-lg mt-6">{step.title}</h3>
                <p className="dex-body mt-3">{step.body}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

function fromLeftRotate(index: number): number {
  return index % 2 === 0 ? -12 : 12;
}
