"use client";

import { motion, useReducedMotion } from "motion/react";

export function RobotMascot() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="relative h-7 w-7 shrink-0 cursor-default"
      initial={false}
      whileHover="wave"
      aria-hidden="true"
    >
      <motion.svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        animate={
          reduce
            ? undefined
            : { y: [0, -1.5, 0] }
        }
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <motion.line
          x1="14"
          y1="3"
          x2="14"
          y2="6.5"
          stroke="var(--dex-text-tertiary)"
          strokeWidth="1.2"
        />
        <motion.circle
          cx="14"
          cy="2.3"
          r="1.4"
          fill="var(--dex-accent)"
          animate={
            reduce
              ? undefined
              : { opacity: [0.5, 1, 0.5], scale: [1, 1.15, 1] }
          }
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />

        <rect
          x="5"
          y="6.5"
          width="18"
          height="15"
          rx="6"
          fill="var(--dex-bg-elevated-2)"
          stroke="var(--dex-border)"
          strokeWidth="1"
        />

        <motion.g
          animate={
            reduce
              ? undefined
              : { scaleY: [1, 1, 0.1, 1, 1] }
          }
          transition={{
            duration: 3.6,
            repeat: Infinity,
            times: [0, 0.85, 0.9, 0.95, 1],
            ease: "easeInOut",
          }}
          style={{ transformOrigin: "14px 14px" }}
        >
          <circle cx="10.5" cy="14" r="1.6" fill="var(--dex-text-primary)" />
          <circle cx="17.5" cy="14" r="1.6" fill="var(--dex-text-primary)" />
        </motion.g>

        <motion.line
          x1="5.5"
          y1="12"
          x2="2.5"
          y2="10.5"
          stroke="var(--dex-text-tertiary)"
          strokeWidth="1.4"
          strokeLinecap="round"
          variants={{ wave: { rotate: [0, -18, 12, -14, 0] } }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
          style={{ transformOrigin: "5.5px 12px" }}
        />
        <motion.line
          x1="22.5"
          y1="12"
          x2="25.5"
          y2="13.5"
          stroke="var(--dex-text-tertiary)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </motion.svg>
    </motion.div>
  );
}
