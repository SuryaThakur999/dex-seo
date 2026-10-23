import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayCard } from './today-card';

const fetchMock = vi.fn();
const mission = { icon: '🚀', title: 'Start a New Audit', description: 'd', cta: 'New Scan', ctaHref: '#scan-control' };

describe('TodayCard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => mission });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders the summary subtitle and the mission button', async () => {
    render(<TodayCard websiteId="site_1" pendingReviewCount={0} competitorChangeCount={0} postIdeaCount={0} summary={<p>3 pages flagged.</p>} />);
    expect(screen.getByText('3 pages flagged.')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByRole('link', { name: 'New Scan' })).toHaveAttribute('href', '#scan-control');
  });

  it('shows up to 2 waiting-for-you rows, one per nonzero count, and nothing for a zero count', async () => {
    render(<TodayCard websiteId="site_1" pendingReviewCount={11} competitorChangeCount={2} postIdeaCount={0} summary={null} />);
    await act(async () => {});
    expect(screen.getByText('2 competitor changes')).toBeInTheDocument();
    expect(screen.queryByText(/post idea/)).not.toBeInTheDocument();
  });

  it('never shows a review-count row, since the mission button below already states that count (no duplicate count)', async () => {
    render(<TodayCard websiteId="site_1" pendingReviewCount={11} competitorChangeCount={0} postIdeaCount={0} summary={null} />);
    await act(async () => {});
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
  });

  it('renders nothing in the waiting list when all three counts are zero', async () => {
    render(<TodayCard websiteId="site_1" pendingReviewCount={0} competitorChangeCount={0} postIdeaCount={0} summary={null} />);
    await act(async () => {});
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
