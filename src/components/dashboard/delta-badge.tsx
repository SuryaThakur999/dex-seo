import { ArrowUp, ArrowDown } from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/utils';

export function DeltaBadge({ delta }: { delta?: number | null }) {
  if (delta === undefined || delta === null) return null;

  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
        0%
      </span>
    );
  }

  const isPositive = delta > 0;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
        isPositive ? 'text-[var(--dex-app-success)]' : 'text-[var(--dex-app-danger)]'
      )}
      style={{ backgroundColor: isPositive ? 'var(--dex-app-success-bg)' : 'var(--dex-app-danger-bg)' }}
      aria-label={`${isPositive ? 'up' : 'down'} ${Math.abs(delta)} percent`}
    >
      {isPositive ? <ArrowUp size={10} weight="bold" aria-hidden="true" /> : <ArrowDown size={10} weight="bold" aria-hidden="true" />}
      {Math.abs(delta)}%
    </span>
  );
}
