import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('motion/react', () => ({ useReducedMotion: () => true }));

import { LiveScanPanel } from './live-scan-panel';

afterEach(() => cleanup());

// Dashboard IA rebuild (2026-10-16 spec): at rest, LiveScanPanel collapses to a single header
// status line ("Last checked … · Check again") instead of either the dark terminal card or the
// separate Scan activity job-history card (that history card moves to Analytics unchanged, see
// page.tsx). The terminal only expands while a scan is actually running or the reader explicitly
// asks to see the report again.
describe('LiveScanPanel idle folding', () => {
  it('shows the slim "No scans yet · Check again" status line when there are no jobs at all', () => {
    render(
      <LiveScanPanel
        websiteId="site_1"
        initialJobs={[]}
        opportunitiesFoundCount={0}
        draftsReadyCount={0}
        previewMode
      />,
    );
    expect(screen.queryByText('Live activity')).not.toBeInTheDocument();
    expect(document.getElementById('scan-control')).toHaveTextContent('No scans yet');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('still shows the Live activity terminal card while a scan is in flight', () => {
    render(
      <LiveScanPanel
        websiteId="site_1"
        initialJobs={[{ id: 'job_1', status: 'running', createdAt: new Date(), completedAt: null, error: null, resultSummary: null }]}
        opportunitiesFoundCount={0}
        draftsReadyCount={0}
        previewMode
      />,
    );
    expect(screen.getByText('Live activity')).toBeInTheDocument();
  });

  it('shows the failed detail inline in the slim status line, not a terminal card, for a failed job with no log history', () => {
    render(
      <LiveScanPanel
        websiteId="site_1"
        initialJobs={[{ id: 'job_1', status: 'failed', createdAt: new Date(), completedAt: new Date(), error: 'Timed out', resultSummary: null }]}
        opportunitiesFoundCount={0}
        draftsReadyCount={0}
        previewMode
      />,
    );
    expect(screen.queryByText('Live activity')).not.toBeInTheDocument();
    expect(document.getElementById('scan-control')).toHaveTextContent(/Last scan failed: Timed out/);
  });

  it('at rest, shows a slim "Last checked … · Check again" status line with id="scan-control" instead of the job-history card', () => {
    render(
      <LiveScanPanel
        websiteId="site_1"
        initialJobs={[{ id: 'j1', status: 'completed', createdAt: new Date('2026-10-14'), completedAt: new Date('2026-10-14'), error: null, resultSummary: { pagesScanned: 10, pagesFlagged: 2, draftsCreated: 1, errors: [] } }]}
        opportunitiesFoundCount={2}
        draftsReadyCount={1}
        previewMode
      />,
    );
    const status = document.getElementById('scan-control');
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent(/Last checked/);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    expect(screen.queryByText('Scan now')).not.toBeInTheDocument();
  });

  it('expands the full terminal while a scan is in flight, still inside #scan-control', () => {
    render(
      <LiveScanPanel
        websiteId="site_1"
        initialJobs={[{ id: 'j1', status: 'running', createdAt: new Date(), completedAt: null, error: null, resultSummary: null }]}
        opportunitiesFoundCount={0}
        draftsReadyCount={0}
        previewMode
      />,
    );
    expect(document.getElementById('scan-control')).toContainElement(screen.getByText('Live activity'));
  });
});
