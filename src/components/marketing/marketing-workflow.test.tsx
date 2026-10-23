import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hero } from './hero';
import { StatusBoardSection } from './status-board-section';
import { TestimonialsSection } from './testimonials-section';
import { RoadmapSection } from './roadmap-section';

vi.stubGlobal('React', React);

beforeAll(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('ResizeObserver', ObserverStub);
});

afterEach(cleanup);

describe('marketing workflow', () => {
  it('leads the hero with the audit call to action', () => {
    render(<Hero />);
    const button = screen.getByRole('button', { name: 'Start my audit' });
    expect(button.closest('form')?.getAttribute('action')).toBe('/sign-up');
    expect(screen.getByLabelText('Your website address').getAttribute('name')).toBe('site');
  });

  it('leads the flip board with the Dex mission line', () => {
    render(<StatusBoardSection />);
    expect(screen.getByRole('heading', { name: /marketing team it stays in charge of/ })).toBeTruthy();
  });

  it('shows the illustrative disclaimer on the testimonials', () => {
    render(<TestimonialsSection />);
    expect(screen.getByText('Illustrative example scenarios, not verified customer testimonials.')).not.toHaveClass('sr-only');
    expect(screen.getByText('Illustrative Beispielszenarien, keine verifizierten Kundenstimmen.')).toBeTruthy();
  });

  it('separates live team members from planned channels', () => {
    render(<RoadmapSection />);
    expect(screen.getAllByText('Live now')).toHaveLength(5);
    expect(screen.getByText('Planned, not available today.')).toBeTruthy();
  });
});
