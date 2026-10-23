import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UtilityBar } from './utility-bar';

vi.mock('@clerk/nextjs', () => ({ UserButton: () => <div data-testid="user-button" /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

describe('UtilityBar — 320px header overflow fix (overseer polish, 2026-10-16)', () => {
  it('wraps the header row instead of forcing a fixed-width overflow at narrow viewports', () => {
    render(
      <UtilityBar
        websiteUrl="https://bakery.de"
        gscConnected={false}
        lastRefresh={null}
        websites={[{ id: 'a', url: 'https://bakery.de' }]}
        currentWebsiteId="a"
        showAddWebsite
      />,
    );
    const badge = screen.getByText('Search Console not connected');
    // The header row (site switcher + badge + avatar) must be allowed to wrap onto a second
    // line below the sm breakpoint -- a non-wrapping row is what produced document.scrollWidth
    // (405) exceeding the 320px viewport on live prod (overseer's signed-in screenshot pass).
    let row: HTMLElement | null = badge;
    while (row && !row.className.includes('justify-between')) row = row.parentElement;
    expect(row).not.toBeNull();
    expect(row!.className).toContain('flex-wrap');
  });
});
