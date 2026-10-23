import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OpportunityMapChart } from './opportunity-map-chart';
import type { OpportunityMapPoint } from '@/lib/opportunity-map';

function point(key: string, impact: 1 | 2 | 3 | null): OpportunityMapPoint {
  return { key, issueLabel: key, impact, effort: 1, pageCount: 1 };
}

describe('OpportunityMapChart', () => {
  afterEach(cleanup);

  it('shows nothing when there are no opportunities at all', () => {
    const { container } = render(<OpportunityMapChart points={[]} />);
    expect(screen.getByText('No open opportunities to map right now.')).toBeInTheDocument();
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it('hides the chart and shows a plain message with fewer than 3 rated opportunities', () => {
    const points = [point('a', 1), point('b', null), point('c', null), point('d', null)];
    render(<OpportunityMapChart points={points} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Not enough rated opportunities yet to map (1 of 3 needed).')).toBeInTheDocument();
    expect(screen.getByText('Not rated (no severity data)')).toBeInTheDocument();
  });

  it('renders the chart once at least 3 opportunities are rated', () => {
    const points = [point('a', 1), point('b', 2), point('c', 3), point('d', null)];
    render(<OpportunityMapChart points={points} />);
    expect(screen.getByRole('img', { name: /Opportunity map/ })).toBeInTheDocument();
    expect(screen.queryByText(/Not enough rated/)).not.toBeInTheDocument();
  });
});
