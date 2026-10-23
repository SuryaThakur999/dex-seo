import React from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteSwitcher } from './site-switcher';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.stubGlobal('React', React);

const websites = [
  { id: 'main', url: 'https://example.de' },
  { id: 'shop', url: 'https://shop.example.de' },
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SiteSwitcher', () => {
  it('shows the actual profile name and selected URL in a Radix trigger', () => {
    render(<SiteSwitcher websites={websites} currentWebsiteId="main" profileName="Example GmbH" />);
    const trigger = screen.getByRole('combobox', { name: 'Switch website' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveTextContent('Example GmbH');
    expect(trigger).toHaveTextContent('https://example.de');
  });

  it('opens with the keyboard and navigates to the selected website', () => {
    render(<SiteSwitcher websites={websites} currentWebsiteId="main" profileName="Example GmbH" />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const option = screen.getByRole('option', { name: /shop\.example\.de/ });
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/dashboard/shop');
  });

  it('does not invent a company name when none is available', () => {
    render(<SiteSwitcher websites={websites} currentWebsiteId="shop" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('https://shop.example.de');
    expect(screen.queryByText('Example GmbH')).not.toBeInTheDocument();
  });

  // Brand-voice-isolation fix (2026-10-16): once websites span more than one company, every
  // dropdown item showing the single currently-selected profileName would be wrong -- a site
  // belonging to a different company must show ITS OWN company name, not whichever one
  // happens to be selected right now.
  it('shows each website\'s own company name in the list, not the globally selected one', () => {
    render(
      <SiteSwitcher
        websites={[
          { id: 'a', url: 'https://a.test', profileName: 'Acme' },
          { id: 'b', url: 'https://b.test', profileName: 'Beta Co' },
        ]}
        currentWebsiteId="a"
        profileName="Acme"
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const option = screen.getByRole('option', { name: /beta co.*b\.test/i });
    expect(option).toBeInTheDocument();
  });

  it('falls back to the global profileName for an item with no per-website name of its own', () => {
    render(
      <SiteSwitcher
        websites={[{ id: 'a', url: 'https://a.test' }]}
        currentWebsiteId="a"
        profileName="Example GmbH"
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /example gmbh.*a\.test/i })).toBeInTheDocument();
  });

  it('shows an Add website control that reveals WebsiteEntryPanel inline when showAddWebsite is true', () => {
    render(<SiteSwitcher websites={[{ id: '1', url: 'a.test' }]} currentWebsiteId="1" showAddWebsite gscConnected />);
    expect(screen.queryByText('What website should Dex check?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add website' }));
    expect(screen.getByText('What website should Dex check?')).toBeInTheDocument();
  });

  it('does not show an Add website control when showAddWebsite is false or omitted', () => {
    render(<SiteSwitcher websites={[{ id: '1', url: 'a.test' }]} currentWebsiteId="1" />);
    expect(screen.queryByRole('button', { name: 'Add website' })).not.toBeInTheDocument();
  });

  it('lets the select + Add website button wrap instead of forcing a fixed-width overflow at 320px (overseer polish, 2026-10-16)', () => {
    render(<SiteSwitcher websites={[{ id: '1', url: 'a.test' }]} currentWebsiteId="1" showAddWebsite />);
    const button = screen.getByRole('button', { name: 'Add website' });
    expect(button.parentElement!.className).toContain('flex-wrap');
  });
});
