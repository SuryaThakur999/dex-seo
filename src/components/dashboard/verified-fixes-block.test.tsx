import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VerifiedFixesBlock } from './verified-fixes-block';
import type { VerifiedFixesData } from '@/lib/verified-on-rescan';

afterEach(cleanup);

const filled: VerifiedFixesData = {
  last30: { count: 2, medianDaysToVerify: 4 },
  last90: { count: 3, medianDaysToVerify: 5 },
  byRule: [
    {
      ruleId: 'missing_canonical',
      rejectedAsFalsePositiveRate: 0.25,
      rows: [
        { pageUrl: 'https://example.com/blog', firstFoundAt: '2026-10-01T00:00:00Z', resolvedAt: '2026-10-05T00:00:00Z', resolution: 'fixed', proofLine: 'canonical tag found: https://example.com/blog' },
      ],
    },
    {
      ruleId: 'missing_structured_data',
      rejectedAsFalsePositiveRate: null,
      rows: [
        { pageUrl: 'https://example.com/about', firstFoundAt: '2026-09-20T00:00:00Z', resolvedAt: '2026-09-25T00:00:00Z', resolution: 'excluded', proofLine: 'Excluded from index on purpose' },
      ],
    },
  ],
};

describe('VerifiedFixesBlock', () => {
  it('renders the empty state and no table when there is no data and it is not loading', () => {
    render(<VerifiedFixesBlock data={null} loading={false} />);
    expect(screen.getByText(/No verified fixes yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders a loading state instead of the empty-state copy while loading', () => {
    render(<VerifiedFixesBlock data={null} loading={true} />);
    expect(screen.queryByText(/No verified fixes yet/)).not.toBeInTheDocument();
  });

  it('renders the 30/90-day counts and median when filled', () => {
    render(<VerifiedFixesBlock data={filled} loading={false} />);
    expect(screen.getByText(/30 day/i)).toBeInTheDocument();
    expect(screen.getByText(/90 day/i)).toBeInTheDocument();
    expect(screen.getByText('median 4 day(s) to verify')).toBeInTheDocument();
    expect(screen.getByText('median 5 day(s) to verify')).toBeInTheDocument();
  });

  it('renders each rule group with its rows and proof line', () => {
    render(<VerifiedFixesBlock data={filled} loading={false} />);
    expect(screen.getByText('missing_canonical')).toBeInTheDocument();
    expect(screen.getByText('missing_structured_data')).toBeInTheDocument();
    expect(screen.getByText('canonical tag found: https://example.com/blog')).toBeInTheDocument();
    expect(screen.getByText('Excluded from index on purpose')).toBeInTheDocument();
  });

  it('shows the false-positive rejection rate only for a rule that has one', () => {
    render(<VerifiedFixesBlock data={filled} loading={false} />);
    expect(screen.getByText(/25%/)).toBeInTheDocument();
  });
});
