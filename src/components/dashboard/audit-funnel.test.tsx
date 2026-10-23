import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { AuditFunnel, stageBarWidthPct } from './audit-funnel';
import type { FunnelStage } from '@/lib/dashboard-stats';

describe('stageBarWidthPct', () => {
  it('clamps a stage that exceeds its predecessor (e.g. multiple findings per page) to 100', () => {
    expect(stageBarWidthPct(158)).toBe(100);
  });

  it('passes through an in-range percentage unchanged', () => {
    expect(stageBarWidthPct(50)).toBe(50);
  });

  it('floors a very small nonzero percentage to stay visible', () => {
    expect(stageBarWidthPct(1)).toBe(4);
  });

  it('renders the funnel baseline at full width when there is no preceding stage to compare against', () => {
    expect(stageBarWidthPct(null)).toBe(100);
  });
});

// Matches the project's existing convention for hookless function components (see
// action-detail.test.tsx / scan-stage-breadcrumb.test.tsx): call the component as a plain
// function and inspect the returned element tree -- no @testing-library/react in this repo.
describe('AuditFunnel', () => {
  function barWidths(stages: FunnelStage[]): string[] {
    const tree = AuditFunnel({ stages }) as ReactElement;
    const rows = tree.props.children as ReactElement[];
    return rows.map((row) => {
      const barTrack = (row.props.children as ReactElement[])[1];
      const bar = barTrack.props.children as ReactElement;
      return bar.props.style.width as string;
    });
  }

  it('keeps every bar at or under 100% even when a stage outgrew its predecessor', () => {
    const stages: FunnelStage[] = [
      { label: 'Crawled', count: 40, pctOfPrevious: null },
      { label: 'Findings', count: 63, pctOfPrevious: 158 },
      { label: 'Draft-ready', count: 84, pctOfPrevious: 133 },
    ];
    for (const width of barWidths(stages)) {
      expect(Number.parseFloat(width)).toBeLessThanOrEqual(100);
    }
  });

  it('keeps the real, uncapped percentage in the text label regardless of the bar clamp', () => {
    const stages: FunnelStage[] = [
      { label: 'Crawled', count: 40, pctOfPrevious: null },
      { label: 'Findings', count: 63, pctOfPrevious: 158 },
    ];
    const tree = AuditFunnel({ stages }) as ReactElement;
    // The percentage renders as separate JSX children (["(", 158, "%)"]), not one string --
    // assert on the real value (158), not a literal "(158%)" substring.
    expect(JSON.stringify(tree)).toContain('"(",158,"%)"');
  });
});
