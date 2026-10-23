import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompetitorListPanel, type CompetitorEntityItem } from './competitor-list-panel';

const competitor: CompetitorEntityItem = {
  id: 'comp_1', name: 'Acme Bakery', canonicalDomain: 'acme-bakery.test',
  classification: 'direct', classificationReason: 'Matches an existing entity by domain.', userConfirmed: true,
};

describe('CompetitorListPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(cleanup);

  it('shows each competitor with its name, domain and classification reason', () => {
    render(<CompetitorListPanel clientProfileId="profile_1" initialCompetitors={[competitor]} />);
    expect(screen.getByRole('heading', { name: 'Competitors', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Acme Bakery')).toBeInTheDocument();
    expect(screen.getByText('acme-bakery.test')).toBeInTheDocument();
  });

  it('adds a new competitor via the form and appends it to the list', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ competitor: { id: 'comp_2', name: 'New Co', canonicalDomain: null, classification: 'unknown', classificationReason: 'No existing entity to compare against; needs human confirmation.', userConfirmed: true } }),
    });
    render(<CompetitorListPanel clientProfileId="profile_1" initialCompetitors={[]} />);

    fireEvent.change(screen.getByLabelText('Competitor name'), { target: { value: 'New Co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add competitor' }));

    await waitFor(() => expect(screen.getByText('New Co')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/client-profile/profile_1/competitors',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows an error and keeps the form filled when adding fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({ error: 'name is required.' }) });
    render(<CompetitorListPanel clientProfileId="profile_1" initialCompetitors={[]} />);

    fireEvent.change(screen.getByLabelText('Competitor name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add competitor' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('name is required.');
  });

  it('removes a competitor on delete', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    render(<CompetitorListPanel clientProfileId="profile_1" initialCompetitors={[competitor]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Acme Bakery' }));

    await waitFor(() => expect(screen.queryByText('Acme Bakery')).not.toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/client-profile/profile_1/competitors/comp_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
