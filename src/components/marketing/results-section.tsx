'use client';

import { motion, useReducedMotion } from 'motion/react';
import { CheckCircle, XCircle } from '@phosphor-icons/react';

// Real findings from Dex's own scans in October 2026, each confirmed fixed by a later Dex scan.
// Edit only from scan results: no rounded-up counts, no outcomes a scan did not measure.
const SITES = [
  {
    site: 'dex-ai-plum.vercel.app',
    label: 'Dex, scanned by Dex',
    checks: [
      { name: 'Google description', before: 'Showed an internal note', after: 'Real description' },
      { name: 'Sitemap', before: 'Missing', after: 'Live' },
      { name: 'robots.txt', before: 'Missing', after: 'Live' },
      { name: 'Main-page tag (canonical)', before: 'Missing', after: 'Set' },
      { name: 'Company markup', before: 'Missing', after: 'Added' },
      { name: 'FAQ markup for AI answers', before: 'Missing', after: 'Added' },
    ],
  },
  {
    site: 'yoki-ai-fintech.fly.dev',
    label: 'Yoki, a fintech launch site',
    checks: [
      { name: 'Main-page tags (canonical)', before: 'Missing on 4 pages', after: 'Set' },
      { name: 'Company markup', before: 'Missing', after: 'Added' },
      { name: 'Internal links', before: 'Pages with none', after: 'Linked' },
      { name: '/trust page', before: 'Did not load', after: 'Loads' },
      { name: 'Sitemap and robots.txt', before: 'Missing', after: 'Live' },
      { name: 'License file in Google', before: 'Indexed as a page', after: 'Excluded' },
    ],
  },
];

const TOTAL_FIXES = SITES.reduce((sum, s) => sum + s.checks.length, 0);
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

function CheckRow({ name, before, after, index }: { name: string; before: string; after: string; index: number }) {
  const reduce = useReducedMotion();
  // Each row lands red, then flips to green: the same before/after the scans recorded.
  const flipDelay = 0.5 + index * 0.18;

  return (
    <li className="flex flex-col items-start gap-1 border-b border-[#232329] py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-[0.9375rem] text-[#c4c4cc] md:text-base">{name}</span>
      <span className="inline-grid shrink-0 justify-items-start sm:justify-items-end sm:text-right">
        {!reduce && (
          <motion.span
            aria-hidden="true"
            className="col-start-1 row-start-1 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-[#ff6b5e]"
            initial={{ opacity: 1, y: 0 }}
            whileInView={{ opacity: 0, y: -6 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.3, ease: EASE_OUT, delay: flipDelay }}
          >
            <XCircle size={18} weight="fill" aria-hidden="true" />
            {before}
          </motion.span>
        )}
        <motion.span
          className="col-start-1 row-start-1 inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold text-[#3ddc97]"
          initial={reduce ? false : { opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.3, ease: EASE_OUT, delay: reduce ? 0 : flipDelay + 0.12 }}
        >
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          <span className="sr-only">Before: {before}. Now: </span>
          {after}
        </motion.span>
      </span>
    </li>
  );
}

export function ResultsSection() {
  const reduce = useReducedMotion();

  return (
    <section id="results" className="dex-section w-full border-t border-[#232329] bg-[#0B0B0F]">
      <div className="mx-auto max-w-6xl">
        <motion.p
          className="text-[clamp(5rem,14vw,10rem)] font-bold leading-none tracking-[-0.04em] text-[#FF4D2E]"
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          {TOTAL_FIXES}
        </motion.p>
        <motion.h2
          className="dex-h2 mt-3 max-w-4xl"
          initial={reduce ? false : { opacity: 0, x: -48 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        >
          problems fixed on two live sites, each one confirmed by a second scan.
        </motion.h2>
        <p className="dex-lead mt-6">
          Google and AI search kept tripping over all of them, yet nothing on these pages looked broken. Red is what Dex found in October 2026. Green is what the next scan saw.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {SITES.map((s, siteIndex) => (
            <motion.article
              key={s.site}
              className="dex-card rounded-2xl border border-[#232329] bg-[var(--dex-bg-elevated)] p-6 md:p-8"
              initial={reduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.5, ease: EASE_OUT, delay: reduce ? 0 : siteIndex * 0.08 }}
            >
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="dex-label text-[#9a9aa5]">{s.label}</p>
                  <p className="mt-1 font-mono text-[0.9375rem] text-[#f4f4f6]">{s.site}</p>
                </div>
                <p className="shrink-0 text-[0.9375rem] font-semibold text-[#3ddc97]">
                  {s.checks.length} of {s.checks.length} fixed
                </p>
              </div>
              <ul className="mt-6">
                {s.checks.map((check, i) => (
                  <CheckRow key={check.name} index={i} {...check} />
                ))}
              </ul>
            </motion.article>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <a
            href="/sign-up"
            className="dex-press inline-flex min-h-12 items-center rounded-full bg-[#FF4D2E] px-7 text-[0.9375rem] font-bold text-white hover:bg-[#FF6E4D]"
          >
            Find what your site is missing
          </a>
          <p className="text-[0.9375rem] text-[#9a9aa5]">Free to start. Nothing changes on your site unless you paste it in.</p>
        </div>
      </div>
    </section>
  );
}
