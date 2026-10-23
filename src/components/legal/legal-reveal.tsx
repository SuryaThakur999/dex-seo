'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

// Sections settle in once as they enter the viewport: short, ease-out, no bounce.
// Reduced motion shows everything immediately.
export function LegalReveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, transform: 'translateY(12px)' }}
      whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
