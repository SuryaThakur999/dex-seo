import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { SplitCompanyButton } from './split-company-button';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });

async function settle() {
  await act(async () => {});
}

describe('SplitCompanyButton (brand-voice-isolation fix, 2026-10-16)', () => {
  it('posts to split-company and refreshes on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ clientProfileId: 'cp_new' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SplitCompanyButton websiteId="w1" />);

    fireEvent.click(screen.getByRole('button', { name: /make this its own company/i }));
    await settle();

    expect(fetchMock).toHaveBeenCalledWith('/api/websites/w1/split-company', { method: 'POST' });
    expect(refresh).toHaveBeenCalled();
  });

  it('shows an error without silently dropping a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Could not split this website into its own company.' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SplitCompanyButton websiteId="w1" />);

    fireEvent.click(screen.getByRole('button', { name: /make this its own company/i }));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('Could not split this website into its own company.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
