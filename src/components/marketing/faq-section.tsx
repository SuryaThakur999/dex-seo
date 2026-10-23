'use client';

import { motion, useReducedMotion } from 'motion/react';
import { Plus, ShieldCheck, LockKey, HandPalm } from '@phosphor-icons/react';
import { FAQ } from './faq-content';

// Facts only: the database runs in AWS eu-central-1 (Frankfurt). Do not add pricing numbers
// or certifications here until they exist.
const TRUST = [
  { Icon: LockKey, text: 'Data stored in Frankfurt, Germany (EU)' },
  { Icon: HandPalm, text: 'No access to your CMS, ever' },
  { Icon: ShieldCheck, text: 'Nothing goes live without your approval' },
];



export function FaqSection() {
  const reduce = useReducedMotion();
  return (
    <section id="faq" aria-labelledby="faq-heading" className="dex-section w-full border-t border-[#232329] bg-[#0B0B0F]">
      <div className="mx-auto max-w-6xl">
        <ul className="grid gap-3 sm:grid-cols-3">
          {TRUST.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-3 rounded-2xl border border-[#232329] bg-[var(--dex-bg-elevated)] px-4 py-4 text-[0.9375rem] leading-snug text-[#c4c4cc]">
              <Icon size={20} weight="light" className="shrink-0 text-[var(--dex-accent-secondary)]" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>

        <div className="mt-24 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-16">
        <motion.h2
          id="faq-heading"
          className="dex-h2"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          Questions before you start
        </motion.h2>

        <div className="border-t border-[#232329]">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group border-b border-[#232329]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-left text-[1.0625rem] font-medium text-[#f4f4f6] transition-colors duration-200 hover:text-[var(--dex-accent)] [&::-webkit-details-marker]:hidden">
                {q}
                <Plus
                  size={18}
                  aria-hidden="true"
                  className="shrink-0 text-[#9a9aa5] transition-transform duration-200 ease-out group-open:rotate-45"
                />
              </summary>
              <p className="dex-body pb-6 pr-10">{a}</p>
            </details>
          ))}
        </div>
        </div>
      </div>
    </section>
  );
}
