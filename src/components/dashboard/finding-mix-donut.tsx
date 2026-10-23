'use client';

import { PieChart, Pie, Cell } from 'recharts';
import type { CategoryCount } from '@/lib/dashboard-stats';
import { RULE_LABEL } from './seo-findings-panel';

// Fixed order, validated for CVD/normal-vision separation on both Dex surfaces (see
// globals.css's own comment on these tokens) — never cycled, never assigned by rank.
const SLOT_COLORS = [
  'var(--dex-app-chart-1)',
  'var(--dex-app-chart-2)',
  'var(--dex-app-chart-3)',
  'var(--dex-app-chart-4)',
  'var(--dex-app-chart-5)',
  'var(--dex-app-chart-6)',
];

// Light-mode contrast WARN on 3 of the 6 slots (documented in globals.css) means identity
// must never rely on color alone here — the legend below is not optional decoration, it is
// the accessibility relief the validator requires.
export function FindingMixDonut({ counts }: { counts: CategoryCount[] }) {
  if (counts.length === 0) {
    return <p className="text-sm text-muted-foreground">No findings from your most recent scan.</p>;
  }
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const data = counts.map((c, i) => ({
    name: RULE_LABEL[c.category] ?? c.category,
    value: c.count,
    color: SLOT_COLORS[i % SLOT_COLORS.length],
  }));

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <PieChart width={180} height={180} role="img" aria-label="Finding mix by type">
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={56} outerRadius={80} paddingAngle={2} stroke="none">
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold text-foreground">{total}</span>
          <span className="text-[10px] text-muted-foreground">findings</span>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
            <span className="text-foreground">{d.name}</span>
            <span className="text-muted-foreground">
              {d.value} · {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
