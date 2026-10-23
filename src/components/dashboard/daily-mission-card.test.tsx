import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyMissionCard } from './daily-mission-card';

const fetchMock = vi.fn();
const missions = [
  { icon: '🔍', title: 'Audit in Progress', description: 'Follow the latest scan as it runs.', cta: 'Watch Feed', ctaHref: '#work-feed' },
  { icon: '📋', title: 'Review 2 Pending Actions', description: 'Draft changes are waiting for your decision.', cta: 'Open Review Queue', ctaHref: '/review' },
  { icon: '🚀', title: 'Start a New Audit', description: 'Run an audit to find the next opportunity.', cta: 'New Scan', ctaHref: '#scan-control' },
];

describe('DailyMissionCard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => missions[0] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows loading feedback and fetches the encoded website ID', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<DailyMissionCard websiteId="site /?" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your next mission');
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/daily-mission?websiteId=site%20%2F%3F', expect.any(Object));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each(missions)('renders $title with its actionable link', async mission => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => mission });
    render(<>
      <DailyMissionCard websiteId="site_1" />
      <div id="work-feed">Feed target</div>
      <div id="scan-control">Scan target</div>
    </>);
    await act(async () => {});

    expect(screen.getByRole('heading', { name: mission.title })).toBeInTheDocument();
    expect(screen.getByText(mission.description)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: mission.cta });
    expect(link).toHaveAttribute('href', mission.ctaHref);
    if (mission.ctaHref.startsWith('#')) {
      expect(document.querySelector(mission.ctaHref)).toBeInTheDocument();
    } else {
      expect(link).toHaveAttribute('href', '/review');
    }
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    { name: 'HTTP error', result: () => Promise.resolve({ ok: false }) },
    { name: 'network error', result: () => Promise.reject(new Error('offline')) },
  ])('shows recovery text without an inert CTA on $name', async ({ result }) => {
    fetchMock.mockImplementation(result);
    render(<DailyMissionCard websiteId="site_1" />);
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your next mission. Refresh to try again.");
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('ignores a previous website response after switching sites', async () => {
    let resolveOld!: (value: { ok: boolean; json: () => Promise<typeof missions[number]> }) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => missions[1] });
    const { rerender } = render(<DailyMissionCard websiteId="old_site" />);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender(<DailyMissionCard websiteId="new_site" />);
    await act(async () => {});
    await act(async () => { resolveOld({ ok: true, json: async () => missions[0] }); });

    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('link', { name: 'Open Review Queue' })).toHaveAttribute('href', '/review');
    expect(screen.queryByRole('link', { name: 'Watch Feed' })).not.toBeInTheDocument();
  });
});
