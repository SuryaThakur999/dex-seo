"use client";

import { type FC, useState, forwardRef } from "react";
import { motion, type Transition } from "motion/react";
import useMeasure from "react-use-measure";
import { CaretRight, type Icon as PhosphorIcon } from "@phosphor-icons/react";

interface ToolbarItem {
  icon: PhosphorIcon;
  label: string;
}

interface ExtendedToolbarProps {
  primaryItems?: ToolbarItem[];
  secondaryItems?: ToolbarItem[];
}

const springConfig: Transition = {
  type: "spring",
  stiffness: 240,
  damping: 24,
  mass: 1.2,
};

const SIDE_PADDING = 8;

export const ExtendedToolbar: FC<ExtendedToolbarProps> = ({
  primaryItems = [],
  secondaryItems = [],
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const [primaryRef, primaryBounds] = useMeasure({ offsetSize: true });
  const [secondaryRef, secondaryBounds] = useMeasure({ offsetSize: true });
  const [toggleRef, toggleBounds] = useMeasure({ offsetSize: true });

  const currentWidth = isExpanded
    ? secondaryBounds.width + toggleBounds.width + SIDE_PADDING
    : primaryBounds.width + toggleBounds.width + SIDE_PADDING;

  return (
    <div className="flex items-center justify-center">
      <motion.div
        animate={{ width: currentWidth > 0 ? currentWidth : "auto" }}
        transition={springConfig}
        className="relative overflow-hidden rounded-full border border-[var(--dex-border)] bg-[var(--dex-bg-elevated)] py-2"
      >
        <motion.div
          animate={{ x: isExpanded ? -(primaryBounds.width - SIDE_PADDING) : 0 }}
          transition={springConfig}
          className="flex h-full items-center"
        >
          <div ref={primaryRef} className="flex shrink-0 items-center gap-4 pr-2 pl-4">
            {primaryItems.map((item, i) => (
              <ToolbarIcon key={`p-${i}`} icon={item.icon} active={!isExpanded} />
            ))}
          </div>

          <ToggleButton ref={toggleRef} isOpen={isExpanded} onClick={() => setIsExpanded(!isExpanded)} />

          <div ref={secondaryRef} className="flex shrink-0 items-center gap-4 pr-4 pl-2">
            {secondaryItems.map((item, i) => (
              <ToolbarIcon key={`s-${i}`} icon={item.icon} active={isExpanded} />
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

const ToolbarIcon = ({ icon: Icon, active }: { icon: PhosphorIcon; active: boolean }) => (
  <motion.div
    initial={false}
    animate={{ opacity: active ? 1 : 0, filter: active ? "blur(0px)" : "blur(4px)" }}
    transition={{ duration: 0.2 }}
  >
    <Icon size={20} weight="regular" className="text-[var(--dex-text-secondary)]" />
  </motion.div>
);

interface ToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

const ToggleButton = forwardRef<HTMLDivElement, ToggleButtonProps>(({ isOpen, onClick }, ref) => (
  <div
    ref={ref}
    onClick={onClick}
    className="z-10 flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--dex-bg-elevated-2)] p-2 transition-transform active:scale-95"
  >
    <motion.div initial={false} animate={{ rotate: isOpen ? 180 : 0 }} transition={springConfig}>
      <CaretRight size={16} weight="bold" className="text-[var(--dex-text-primary)]" />
    </motion.div>
  </div>
));
ToggleButton.displayName = "ToggleButton";
