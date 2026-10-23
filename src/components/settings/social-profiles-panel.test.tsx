import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialProfilesPanel } from './social-profiles-panel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle() {
  await act(async () => {});
}

describe('SocialProfilesPanel (social-profile-discovery plan, 2026-10-17)', () => {
  it('renders existing channels with a Remove button per row', () => {
    render(<SocialProfilesPanel clientProfileId="cp_1" profiles={[{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }]} />);
    expect(screen.getByText('https://linkedin.com/company/acme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('removing a channel PATCHes the list without that entry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ socialProfiles: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SocialProfilesPanel clientProfileId="cp_1" profiles={[{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }]} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await settle();

    expect(fetchMock).toHaveBeenCalledWith('/api/client-profile/cp_1/social-profiles', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ socialProfiles: [] }),
    }));
    expect(screen.queryByText('https://linkedin.com/company/acme')).not.toBeInTheDocument();
  });

  it('adding a channel PATCHes the list with the new entry appended', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ socialProfiles: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SocialProfilesPanel clientProfileId="cp_1" profiles={[]} />);

    fireEvent.change(screen.getByLabelText(/channel url/i), { target: { value: 'https://www.instagram.com/acme' } });
    fireEvent.click(screen.getByRole('button', { name: /add a channel/i }));
    await settle();

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ socialProfiles: [{ platform: 'linkedin', url: 'https://www.instagram.com/acme' }] });
  });

  it('shows a request failure without silently dropping it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Unsupported social platform' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SocialProfilesPanel clientProfileId="cp_1" profiles={[{ platform: 'linkedin', url: 'https://linkedin.com/company/acme' }]} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported social platform');
    expect(screen.getByText('https://linkedin.com/company/acme')).toBeInTheDocument();
  });
});
