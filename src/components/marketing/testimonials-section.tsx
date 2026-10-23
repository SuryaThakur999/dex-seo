'use client';

import { motion, useReducedMotion } from 'motion/react';
import { TestimonialsColumn, type Testimonial } from '@/components/ui/testimonials-columns';

const COLUMN_ONE: Testimonial[] = [
  {
    text: 'The five-check gate is what sold me. I have seen too many AI tools publish something wrong before anyone caught it.',
    name: 'Nadine Brandt',
    role: 'Head of Marketing, freight software',
  },
  {
    text: 'Half our pages had zero traffic in Search Console, so no tool ever looked at them. Dex flagged real problems on every single one.',
    name: 'Jonas Wilhelm',
    role: 'Founder, HR tooling startup',
  },
  {
    text: 'It writes a draft, not a decision. Our team still reads every line before it goes live.',
    name: 'Katrin Sorge',
    role: 'Content Lead, fintech SaaS',
  },
];

const COLUMN_TWO: Testimonial[] = [
  {
    text: 'No CMS write access needed. It hands us a draft, we paste it in ourselves. That alone got it past our security review.',
    name: 'Malte Ohlendorf',
    role: 'CTO, logistics platform',
  },
  {
    text: 'The audit log is the reason our compliance team stopped pushing back.',
    name: 'Sabine Rohde',
    role: 'Operations Director, DACH insurtech',
  },
  {
    text: 'Simple to turn on, simple to turn off. Nothing runs without us clicking approve.',
    name: 'Timo Vogt',
    role: 'Growth Lead, developer tools',
  },
];

export function TestimonialsSection() {
  const reduce = useReducedMotion();

  return (
    <section id="testimonials" className="dex-section w-full border-t border-[#232329] bg-[#0B0B0F]">
      <div className="mx-auto max-w-6xl">
        <motion.h2
          className="dex-h2 max-w-3xl"
          initial={reduce ? false : { opacity: 0, x: -48 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        >
          What teams like yours want from Dex
        </motion.h2>
        {/* Legal (UWG): these are illustrative scenarios, not real customers, so the label must stay visible. */}
        <p
          lang="en"
          className="mt-6 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-[#232329] bg-[var(--dex-bg-elevated)] px-4 py-1.5 text-[0.8125rem] text-[#9a9aa5]"
        >
          <span>Illustrative example scenarios, not verified customer testimonials.</span>
          <span lang="de">Illustrative Beispielszenarien, keine verifizierten Kundenstimmen.</span>
        </p>

        <div className="mt-16 flex max-h-[600px] justify-center gap-4 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]">
          <TestimonialsColumn testimonials={COLUMN_ONE} duration={22} className="w-full max-w-xs" />
          <TestimonialsColumn testimonials={COLUMN_TWO} duration={26} className="hidden w-full max-w-xs md:block" />
        </div>
      </div>
    </section>
  );
}
