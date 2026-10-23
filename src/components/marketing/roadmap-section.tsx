'use client';

import { motion, useReducedMotion } from 'motion/react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';

type Member = { name: string; text: string; orb: OrbState };

// "Live now" must only list shipped features; anything unshipped goes under "Next".
const LIVE: Member[] = [
  { name: 'SEO and AI-visibility fixes', text: 'Finds the pages your reports never show and drafts grounded fixes.', orb: 'searching' },
  { name: 'Talk to Dex', text: 'Ask about your marketing in plain language, with your reviewed work as context.', orb: 'listening' },
  { name: 'Marketing Memory', text: 'Your audience, markets and brand voice, remembered across every task.', orb: 'weaving' },
  { name: 'Content Studio', text: 'Post drafts for LinkedIn, X, Instagram, Facebook, TikTok, YouTube and Reddit, built from your own evidence.', orb: 'composing' },
  { name: 'Proof Receipts', text: 'Every decision recorded with its source, checks and outcome.', orb: 'solving' },
];

const NEXT = ['Email', 'Ads', 'PR', 'Analytics'];

export function RoadmapSection() {
  const reduce = useReducedMotion();
  return <section id="team" aria-labelledby="team-heading" className="dex-section border-t border-[#232329] bg-[#0B0B0F]">
    <motion.div className="mx-auto max-w-6xl" initial={false} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: reduce ? 0 : 0.8 }}>
      <h2 id="team-heading" className="dex-h2">Your marketing team, already at work.</h2>
      <p className="dex-lead mt-6">Dex started with SEO. It now drafts content, remembers your brand and answers your questions. Every channel joins under the same rule: nothing goes live without your yes.</p>

      <ul className="mt-12 grid gap-4 md:grid-cols-2">
        {LIVE.map((m, i) => <motion.li
          key={m.name}
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
          className={`dex-card group flex gap-4 rounded-2xl border border-[#232329] bg-[var(--dex-bg-elevated)] p-6 hover:border-[var(--dex-border-accent)] md:p-8 ${i === 0 ? 'md:col-span-2' : ''}`}
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            <ThinkingOrb state={m.orb} size={20} theme="dark" paused={reduce ?? false} />
          </span>
          <div>
            <h3 className="dex-h3 flex flex-wrap items-center gap-2">
              {m.name}
              <span className="dex-label rounded-full border border-[var(--dex-border-accent)] px-2.5 py-0.5 text-[var(--dex-accent)]">Live now</span>
            </h3>
            <p className="dex-body mt-2">{m.text}</p>
          </div>
        </motion.li>)}
      </ul>

      <div className="mt-10 border-t border-[#232329] pt-8">
        <h3 className="dex-h3">Next, one channel at a time</h3>
        <p className="dex-body mt-2">Planned, not available today.</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {NEXT.map(n => <li key={n} className="rounded-full border border-[#232329] px-4 py-1.5 text-[0.9375rem] text-[#c4c4cc]">{n}</li>)}
        </ul>
      </div>

      <p className="dex-body mt-10"><span className="font-semibold text-[#f4f4f6]">Always: you approve.</span> Dex checks every action in every channel, and you decide what goes ahead.</p>
      <p className="dex-h3 mt-10">We&apos;re not done. We&apos;ve barely started.</p>
    </motion.div>
  </section>;
}
