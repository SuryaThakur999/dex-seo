import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompetitorWatchCard } from './competitor-watch-card';

const fetchMock = vi.fn();
const response = (items: unknown[]) => ({ ok: true, json: async () => ({ items }) });

async function settle() {
  await act(async () => {});
}

describe('CompetitorWatchCard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(response([]));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('requests the encoded client profile and shows a loading state first', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<CompetitorWatchCard clientProfileId="profile /?" websiteId="site_1" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading competitor changes');
    expect(fetchMock).toHaveBeenCalledWith('/api/client-profile/profile%20%2F%3F/competitor-watch', expect.any(Object));
  });

  it('shows an honest empty state when there are no detected changes', async () => {
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();
    expect(screen.getByText('No changes yet. Dex checks every Monday.')).toBeInTheDocument();
  });

  it('shows a request failure without claiming there were no changes', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load competitor changes");
    expect(screen.queryByText(/No changes yet/)).not.toBeInTheDocument();
  });

  it('lists each change with the competitor name, dated excerpt, and a Respond-with-a-post link carrying the evidence id', async () => {
    fetchMock.mockResolvedValue(response([
      { id: 'ev_1', competitorName: 'Acme Co', canonicalUrl: 'https://acme.test/pricing', excerpt: 'New pricing tiers announced.', retrievedAt: '2026-10-14T00:00:00.000Z' },
    ]));
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Acme Co')).toBeInTheDocument();
    expect(within(row).getByText('New pricing tiers announced.')).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: 'Respond with a post' });
    expect(link).toHaveAttribute('href', expect.stringContaining('sourceEvidenceId=ev_1'));
    expect(link).toHaveAttribute('href', expect.stringContaining('websiteId=site_1'));
  });

  it('lists multiple changes', async () => {
    fetchMock.mockResolvedValue(response([
      { id: 'ev_1', competitorName: 'Acme Co', canonicalUrl: 'https://acme.test', excerpt: 'Change one.', retrievedAt: '2026-10-14T00:00:00.000Z' },
      { id: 'ev_2', competitorName: 'Beta Inc', canonicalUrl: 'https://beta.test', excerpt: 'Change two.', retrievedAt: '2026-10-13T00:00:00.000Z' },
    ]));
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('empty state shows the exact copy and Add competitors / Check now actions, no tall empty box', async () => {
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();
    expect(screen.getByText('No changes yet. Dex checks every Monday.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add competitors' })).toHaveAttribute('href', expect.stringMatching(/^\/settings\?websiteId=/));
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Competitor watch' })).not.toHaveClass('min-h-24');
  });

  it('empty state lists watched competitors and links to this website settings', async () => {
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" watchedNames={['sevdesk', 'Lexware Office']} />);
    await settle();
    expect(screen.getByText('Watching 2: sevdesk, Lexware Office')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit competitors' })).toHaveAttribute('href', '/settings?websiteId=site_1');
  });

  it('Check now calls the real check-now endpoint and refetches on success', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes('/check-now') ? Promise.resolve({ ok: true, json: async () => ({ changed: 1 }) }) : Promise.resolve(response([]))
    );
    render(<CompetitorWatchCard clientProfileId="profile_1" websiteId="site_1" />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/client-profile/profile_1/competitor-watch/check-now', { method: 'POST' });
  });
});
