import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { WebsiteEntryPanel } from './website-entry-panel';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle() {
  await act(async () => {});
}

describe('WebsiteEntryPanel — new vs existing company (overseer polish, 2026-10-16, item 4)', () => {
  it('does not render the existing-company choice when there are no other companies yet', () => {
    render(<WebsiteEntryPanel currentWebsiteId="w1" gscConnected={false} />);
    expect(screen.queryByRole('radio', { name: /existing company/i })).not.toBeInTheDocument();
  });

  it('defaults to "New company" and posts no clientProfileId when a company list is passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w2' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<WebsiteEntryPanel currentWebsiteId="w1" gscConnected={false} companies={[{ id: 'cp_1', name: 'acme.test' }]} />);

    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://new.test' } });
    fireEvent.click(screen.getByRole('button', { name: /run audit/i }));
    await settle();

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.mode).toBe('new_company');
    expect(sentBody.clientProfileId).toBeUndefined();
  });

  it('posts the chosen clientProfileId when "Another site of an existing company" is selected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w2' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<WebsiteEntryPanel currentWebsiteId="w1" gscConnected={false} companies={[{ id: 'cp_1', name: 'acme.test' }]} />);

    fireEvent.click(screen.getByRole('radio', { name: /existing company/i }));
    fireEvent.change(screen.getByLabelText(/^company$/i), { target: { value: 'cp_1' } });
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://b.test' } });
    fireEvent.click(screen.getByRole('button', { name: /run audit/i }));
    await settle();

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody).toMatchObject({ mode: 'existing_company', clientProfileId: 'cp_1' });
  });
});
