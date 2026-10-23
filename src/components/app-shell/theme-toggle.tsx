'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { motion, useReducedMotion } from 'motion/react';
import { Sun, Moon, DeviceMobile } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: DeviceMobile },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const reduce = useReducedMotion();
  // Avoids a hydration mismatch: the server can't know the resolved theme, so this
  // renders nothing (not a guess) until mounted client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-8 w-[108px]" aria-hidden="true" />;

  return (
    <div role="radiogroup" aria-label="Appearance" className="relative inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'relative flex h-7 w-7 items-center justify-center rounded-sm transition-colors',
              active ? 'text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {active && (
              <motion.div
                layoutId="theme-toggle-active"
                className="absolute inset-0 rounded-sm bg-accent"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <Icon size={14} weight={active ? 'fill' : 'regular'} className="relative" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
