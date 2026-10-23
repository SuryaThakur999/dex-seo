'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { TextFlippingBoard } from '@/components/ui/text-flipping-board';

// Read in order, the board tells the whole Dex loop. Every line is true of the product today.
const MESSAGES: string[] = [
  'EVERY PAGE \nCHECKED',
  'EVEN THE ONES \nNOBODY VISITS',
  'EVERY FIX \nDRAFTED FOR YOU',
  'FIVE CHECKS \nON EVERY DRAFT',
  'NOTHING GOES LIVE \nWITHOUT YOUR YES',
  'SCAN AGAIN \nSEE IT FIXED',
];

export function StatusBoardSection() {
  const [msgIdx, setMsgIdx] = useState(0);
  const reduce = useReducedMotion();

  const next = useCallback(() => setMsgIdx((i) => (i + 1) % MESSAGES.length), []);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(next, 5000);
    return () => clearInterval(id);
  }, [next, reduce]);

  return (
    <section className="dex-section w-full border-t border-[#232329] bg-[#0B0B0F]">
      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={reduce ? false : { opacity: 0, filter: 'blur(8px)' }}
          whileInView={{ opacity: 1, filter: 'blur(0px)' }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="dex-label text-[var(--dex-accent)]">Why Dex exists</p>
          <h2 className="dex-h2 mt-4">
            Dex gives every business a marketing team it stays in charge of, in a world where AI decides who gets
            found.
          </h2>
        </motion.div>

        <div className="mt-12">
          <TextFlippingBoard
            text={MESSAGES[msgIdx]}
            className="rounded-2xl border border-[#232329]"
            reduceMotion={reduce ?? false}
          />
        </div>
      </div>
    </section>
  );
}
