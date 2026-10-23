import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PostIdeasCard } from './post-ideas-card';

afterEach(cleanup);

describe('PostIdeasCard', () => {
  it('shows an honest empty state with no ideas', () => {
    render(<PostIdeasCard websiteId="site_1" ideas={[]} />);
    expect(screen.getByText(/No post ideas yet/)).toBeInTheDocument();
  });

  it('lists each idea with topic, why-now, and a Write post link into Studio', () => {
    render(
      <PostIdeasCard
        websiteId="site_1"
        ideas={[{ id: 'rec_1', topic: 'New hiring trends in logistics', whyNow: 'Competitor published on this topic this week.', sourceDate: '2026-10-14T00:00:00.000Z' }]}
      />
    );
    expect(screen.getByText('New hiring trends in logistics')).toBeInTheDocument();
    expect(screen.getByText('Competitor published on this topic this week.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Write post' });
    expect(link).toHaveAttribute('href', expect.stringContaining('sourceRecommendationId=rec_1'));
    expect(link).toHaveAttribute('href', expect.stringContaining('websiteId=site_1'));
  });

  it('caps the list at 3 ideas', () => {
    const ideas = Array.from({ length: 5 }, (_, i) => ({ id: `rec_${i}`, topic: `Topic ${i}`, whyNow: 'why', sourceDate: '2026-10-14T00:00:00.000Z' }));
    render(<PostIdeasCard websiteId="site_1" ideas={ideas} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
