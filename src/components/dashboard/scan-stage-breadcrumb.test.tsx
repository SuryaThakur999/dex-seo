import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { ScanStageBreadcrumb } from './scan-stage-breadcrumb';
import { STAGE_ORDER } from '@/lib/scan-stages';

// Matches the project's existing convention for hookless function components
// (see seo-findings-panel.test.tsx): call the component as a plain function and
// inspect the returned element tree — no @testing-library/react in this repo.
function labelSpan(el: ReactElement, stage: (typeof STAGE_ORDER)[number]): ReactElement {
  const ol = (el.props.children as ReactElement[])[0];
  const items = ol.props.children as ReactElement[];
  const li = items[STAGE_ORDER.indexOf(stage)];
  const children = li.props.children as unknown[];
  return children[children.length - 1] as ReactElement;
}

describe('ScanStageBreadcrumb', () => {
  it('renders nothing when there is no log history yet', () => {
    expect(ScanStageBreadcrumb({ lines: [], status: 'queued' })).toBeNull();
  });

  it('marks the furthest reached stage as the current step, not later ones', () => {
    const el = ScanStageBreadcrumb({
      lines: [{ message: 'Found 4 pages to check.' }, { message: 'Checking https://x.com...' }],
      status: 'running',
    }) as ReactElement;
    expect(labelSpan(el, 'crawl').props['aria-current']).toBe('step');
    expect(labelSpan(el, 'analyze').props['aria-current']).toBeUndefined();
  });

  it('does not mark Save reached for a job that failed mid-crawl', () => {
    const el = ScanStageBreadcrumb({
      lines: [{ message: 'Checking https://x.com...' }, { message: 'Scan failed: timeout' }],
      status: 'failed',
    }) as ReactElement;
    expect(labelSpan(el, 'crawl').props['aria-current']).toBe('step');
    expect(labelSpan(el, 'crawl').props.className).toContain('text-destructive');
    expect(labelSpan(el, 'save').props['aria-current']).toBeUndefined();
    expect(labelSpan(el, 'save').props.className).toContain('text-muted-foreground');
  });

  it('states the failure footnote honestly — last confirmed stage, not an exact failure point', () => {
    const el = ScanStageBreadcrumb({
      lines: [{ message: 'Checking https://x.com...' }, { message: 'Scan failed: timeout' }],
      status: 'failed',
    }) as ReactElement;
    const footnote = (el.props.children as unknown[])[1] as ReactElement;
    const text = JSON.stringify(footnote.props.children);
    expect(text).toContain('Crawl');
    expect(text).toContain("isn't established");
  });

  it('renders no failure footnote for a running or completed job', () => {
    const running = ScanStageBreadcrumb({ lines: [{ message: 'Checking https://x.com...' }], status: 'running' }) as ReactElement;
    expect((running.props.children as unknown[])[1]).toBeFalsy();
  });
});
