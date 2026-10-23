import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AddWebsiteForm } from './add-website-form';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {});
}

describe('AddWebsiteForm — new vs existing company (brand-voice-isolation fix, 2026-10-16)', () => {
  it('defaults to "New company" and posts no clientProfileId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AddWebsiteForm companies={[{ id: 'cp_1', name: 'acme.test' }]} />);

    fireEvent.change(screen.getByLabelText(/add a website/i), { target: { value: 'https://new.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await settle();

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.mode).toBe('new_company');
    expect(sentBody.clientProfileId).toBeUndefined();
  });

  it('posts the chosen clientProfileId when "Another site of an existing company" is selected', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AddWebsiteForm companies={[{ id: 'cp_1', name: 'acme.test' }]} />);

    fireEvent.click(screen.getByRole('radio', { name: /existing company/i }));
    fireEvent.change(screen.getByLabelText(/^company$/i), { target: { value: 'cp_1' } });
    fireEvent.change(screen.getByLabelText(/add a website/i), { target: { value: 'https://b.test' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await settle();

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody).toMatchObject({ mode: 'existing_company', clientProfileId: 'cp_1' });
  });

  it('does not render the existing-company select when there are no other companies yet', () => {
    render(<AddWebsiteForm companies={[]} />);
    expect(screen.queryByRole('radio', { name: /existing company/i })).not.toBeInTheDocument();
  });
});
