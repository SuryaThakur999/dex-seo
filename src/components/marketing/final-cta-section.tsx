'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { HoverBorderGradient } from '@/components/ui/hover-border-gradient';

// Kept close in length (8-10 chars) so the swap doesn't lurch the layout, and each word
// echoes the hero's "SEO, supervised" badge rather than reading like unrelated filler.
const ROTATING_WORDS = ['reviewed', 'supervised', 'validated'];

export function FinalCtaSection() {
  const [wordIndex, setWordIndex] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setWordIndex((i) => (i + 1) % ROTATING_WORDS.length);
    }, 2200);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <section id="cta" className="dex-section w-full border-t border-[#232329] bg-[#0B0B0F]">
      <motion.div
        className="mx-auto max-w-3xl text-center"
        initial={reduce ? false : { opacity: 0, scale: 0.94 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="dex-h2">
          Every fix is{' '}
          <span className="relative inline-grid justify-items-center align-bottom text-center">
            {reduce ? (
              <span className="text-[#FF4D2E]">{ROTATING_WORDS[wordIndex]}</span>
            ) : (
              ROTATING_WORDS.map((word, index) => (
                <motion.span
                  key={word}
                  // Every word shares this grid cell, so the box always sizes to whichever
                  // word is widest -- no more guessed ch-width fighting the real rendered
                  // width of whatever word is currently showing.
                  className="col-start-1 row-start-1 text-[#FF4D2E]"
                  initial={{ opacity: 0, y: -30, filter: 'blur(6px)' }}
                  animate={
                    wordIndex === index
                      ? { opacity: 1, y: 0, filter: 'blur(0px)' }
                      : { opacity: 0, y: wordIndex > index ? -30 : 30, filter: 'blur(6px)' }
                  }
                  transition={{ type: 'spring', stiffness: 170, damping: 20 }}
                >
                  {word}
                </motion.span>
              ))
            )}
          </span>{' '}
          until you approve it.
        </h2>
        <p className="dex-lead mx-auto mt-6">
          Dex never touches your CMS. It hands you a reviewed draft, and you paste it in yourself, on your schedule.
        </p>

        <motion.div
          className="mt-10 flex justify-center"
          initial={reduce ? false : { opacity: 0, scale: 0.7, y: 14 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={
            reduce
              ? undefined
              : { type: 'spring', stiffness: 260, damping: 16, delay: 0.35 }
          }
        >
          <HoverBorderGradient
            as="a"
            {...({ href: '/sign-up' } as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
            containerClassName="rounded-full"
            className="rounded-full bg-[#FF4D2E] px-8 py-3.5 text-[0.9375rem] font-bold text-white transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            Start my audit
          </HoverBorderGradient>
        </motion.div>
        <p className="mt-5 text-[0.9375rem] text-[#9a9aa5]">Free to start. Nothing changes on your site unless you paste it in.</p>
      </motion.div>
    </section>
  );
}
