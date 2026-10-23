import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { BatchDecisionPanel, type ReviewBatchPreview } from './batch-decision-panel';

const preview: ReviewBatchPreview = {
  groupKey: 'group', websiteId: 'site', clientProfileId: 'profile', sharedCurrentValue: 'Before', sharedDraftContent: 'After',
  items: [{ actionId: 'a1', pageUrl: 'https://site.test/one', revision: 'r1' }, { actionId: 'a2', pageUrl: 'https://site.test/two', revision: 'r2' }],
  policyVersion: 'v1', aiDisclosure: true, reasoning: 'Checks passed', checks: [{ check: 'wording', detail: 'No restricted wording', result: 'pass' }],
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });
function mount(value = preview) { vi.stubGlobal('React', React); return render(<BatchDecisionPanel preview={value} />); }

describe('batch decisions', () => {
  it('focuses confirmation and returns focus to the chosen control on cancel', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reject these 2 changes' }));
    expect(document.activeElement?.textContent).toBe('Reject all 2 changes? No changes will be published.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reject these 2 changes' }));
  });

  it('previews exact pages, content and checks before confirming', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ requestId: 'request', decision: 'approve', actionIds: ['a1', 'a2'] }) });
    vi.stubGlobal('fetch', request);
    mount();
    expect(screen.getByText('https://site.test/one')).toBeDefined();
    expect(screen.getByText('After', { selector: 'p' })).toBeDefined();
    expect(screen.getByText(/No restricted wording/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Approve these 2 changes' }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval of 2 changes' }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(request.mock.calls[0][0]).toBe('/api/actions/batch');
    expect(body).toMatchObject({ websiteId: 'site', decision: 'approve', items: preview.items.map(({ actionId, revision }) => ({ actionId, revision })) });
    expect(body.requestId).toMatch(/^[\da-f-]{36}$/i);
    await screen.findByText('2 approvals saved. Nothing was applied to your website.');
    expect(screen.getAllByRole('link', { name: /View decision/ })).toHaveLength(2);
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload queue' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reuses the request ID after an uncertain failure and prevents double submission', async () => {
    let resolve!: (response: unknown) => void;
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    vi.stubGlobal('fetch', request);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reject these 2 changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection of 2 changes' }));
    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: 'Confirm rejection of 2 changes' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(JSON.parse(request.mock.calls[1][1].body));
    resolve({ ok: true, json: async () => ({ decision: 'reject', actionIds: ['a1', 'a2'] }) });
    await screen.findByText('2 rejections saved. Nothing was applied to your website.');
  });

  it('invalidates a stale preview and requires fresh server data', async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    vi.stubGlobal('fetch', request);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Approve these 2 changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval of 2 changes' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Confirm approval of 2 changes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload queue' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });
});
