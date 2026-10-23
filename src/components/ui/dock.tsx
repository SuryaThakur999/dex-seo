"use client";

import React, { useState, type FC } from "react";
import { motion, type Transition } from "motion/react";
import { cn } from "@/lib/utils";

export interface DockItem {
  id: number;
  label: string;
  Icon: React.ElementType;
  onSelect?: () => void;
}

interface DockProps {
  items: DockItem[];
  className?: string;
}

const dockSpring: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 22,
  mass: 0.7,
};

export const Dock: FC<DockProps> = ({ items, className }) => {
  const [selected, setSelected] = useState<number | null>(null);
  const [animateSelected, setAnimateSelected] = useState<number | null>(null);

  const handleClick = (item: DockItem) => {
    setSelected(item.id);
    setAnimateSelected(item.id);
    setTimeout(() => setAnimateSelected(null), 200);
    item.onSelect?.();
  };

  return (
    <motion.div
      layout
      transition={dockSpring}
      className={cn(
        "relative flex items-end gap-2 rounded-full border border-white/15 px-3 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl backdrop-saturate-150",
        className,
      )}
      style={{
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)), rgba(21,21,27,0.55)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.2), 0 18px 60px rgba(0,0,0,0.45)",
      }}
    >
      {items.map((item) => (
        <motion.button
          key={item.id}
          type="button"
          aria-label={item.label}
          className="group relative"
          onClick={() => handleClick(item)}
          style={{ transformOrigin: "bottom" }}
          initial={{ scale: 1 }}
          whileHover={{ y: -6 }}
          animate={{
            scale: animateSelected === item.id ? 1.25 : 1,
            y: animateSelected === item.id ? -4 : 0,
          }}
          transition={{ type: "spring", stiffness: 550, damping: 15, mass: 1.1 }}
        >
          <motion.div className="cursor-pointer rounded-full p-2.5 text-[var(--dex-text-secondary)] transition-colors duration-200 hover:text-[var(--dex-text-primary)]">
            <item.Icon size={20} weight="regular" />
          </motion.div>

          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#15151b] px-2 py-1 text-[11px] font-medium text-[var(--dex-text-primary)] opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {item.label}
          </span>

          <motion.div
            className={cn(
              "absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--dex-accent)] opacity-0 transition-opacity duration-300",
              selected === item.id && "opacity-100",
            )}
          />
        </motion.button>
      ))}
    </motion.div>
  );
};
