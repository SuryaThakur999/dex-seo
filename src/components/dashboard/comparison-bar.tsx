import { Card, CardContent } from '@/components/ui/card';

export function ComparisonBar({
  label,
  current,
  previous,
  unit = '',
}: {
  label: string;
  current: number;
  previous: number;
  unit?: string;
}) {
  const max = Math.max(current, previous, 1);
  const currentPct = (current / max) * 100;
  const previousPct = (previous / max) * 100;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex flex-col gap-2">
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{ width: `${currentPct}%`, backgroundColor: 'var(--dex-accent, #ff4d2e)' }}
            />
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{ width: `${previousPct}%`, backgroundColor: 'var(--dex-app-amber, #ffb020)' }}
            />
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--dex-accent, #ff4d2e)' }} />
            This week: {current}{unit}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--dex-app-amber, #ffb020)' }} />
            Last week: {previous}{unit}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
