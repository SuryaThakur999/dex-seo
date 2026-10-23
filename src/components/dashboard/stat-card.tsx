'use client';

import type { ReactNode } from 'react';
import { MagicCard } from '@/components/magicui/magic-card';
import { DeltaBadge } from '@/components/dashboard/delta-badge';
import { formatRelativeTime } from '@/lib/dashboard-stats';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  numericValue?: number;
  hint?: string;
  icon: ReactNode;
  tone?: 'default' | 'accent';
  style?: React.CSSProperties;
  delta?: number | null;
  updatedAt?: Date | null;
  chart?: React.ReactNode;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  style,
  delta,
  updatedAt,
  chart,
}: StatCardProps) {
  return (
    // MagicCard's interior fill and gradient border both read `--color-background` (Tailwind's
    // token for the page background). Scoping it to `--color-card` here keeps the card visually
    // distinct from the page instead of blending into it, without editing the vendored component.
    <div className="animate-stat-card-in" style={{ ...style, '--color-background': 'var(--color-card)' } as React.CSSProperties}>
      <MagicCard className="rounded-lg text-card-foreground shadow-sm" gradientColor="var(--muted)" gradientOpacity={0.5} gradientFrom="var(--accent)" gradientTo="var(--dex-app-warning, #ffb020)">
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <span className={cn('inline-flex', tone === 'accent' ? 'text-accent' : 'text-muted-foreground')} aria-hidden="true">
              {icon}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
            <DeltaBadge delta={delta} />
          </div>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          {updatedAt && <span className="text-xs text-muted-foreground">Updated {formatRelativeTime(updatedAt)}</span>}
          {chart && <div className="mt-1">{chart}</div>}
        </div>
      </MagicCard>
    </div>
  );
}
