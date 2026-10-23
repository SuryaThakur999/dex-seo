'use client';

import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import { useState } from 'react';

import { QuestionMark, CheckCircle, GearSix, Sparkle, UsersThree, ArrowUpRight } from '@phosphor-icons/react';
import { Dock, type DockItem } from '@/components/ui/dock';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const DOCK_ITEMS: DockItem[] = [
  { id: 1, label: 'Why Dex', Icon: QuestionMark, onSelect: () => scrollToId('why') },
  { id: 2, label: 'Results', Icon: CheckCircle, onSelect: () => scrollToId('results') },
  { id: 3, label: 'How it works', Icon: GearSix, onSelect: () => scrollToId('how') },
  { id: 4, label: 'What you get', Icon: Sparkle, onSelect: () => scrollToId('what') },
  { id: 5, label: 'Your marketing team', Icon: UsersThree, onSelect: () => scrollToId('team') },
  { id: 6, label: 'Start my audit', Icon: ArrowUpRight, onSelect: () => scrollToId('cta') },
];

export function FloatingDock() {
  // Hidden over the hero (it would cover the audit form) and again near the footer (it would
  // cover the final call to action and footer links). Sits bottom-right so it never lands on
  // centred headings or cards mid-page.
  const { scrollY } = useScroll();
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => {
    const nearFooter = y + window.innerHeight > document.documentElement.scrollHeight - 480;
    setVisible(y > window.innerHeight * 0.6 && !nearFooter);
  });

  return (
    <motion.div
      initial={false}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: reduce ? 0 : 16 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed bottom-6 right-6 z-40 hidden md:flex ${visible ? '' : 'pointer-events-none'}`}
      aria-hidden={!visible}
    >
      <div className={visible ? 'pointer-events-auto' : 'pointer-events-none'}>
        <Dock items={DOCK_ITEMS} />
      </div>
    </motion.div>
  );
}
