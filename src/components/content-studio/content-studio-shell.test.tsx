import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContentStudioShell } from './content-studio-shell';

vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

beforeAll(() => {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ObserverStub);
});

afterEach(cleanup);

const base = {
  clientProfileId: 'cp',
  initialPieces: [],
  pendingActions: [],
  clientProfileDefaults: { audience: null, markets: [], languages: [] },
};

describe('Content Studio evidence picker position and language default (dashboard-IA rebuild, 2026-10-16)', () => {
  it('renders the evidence picker above the Topic field', () => {
    render(<ContentStudioShell {...base} websiteId="r" websiteUrl="https://bakery.de" websites={[]} />);
    const topicLabel = screen.getByText('Topic');
    const pasteLinkTab = screen.getByRole('tab', { name: 'Paste a link' });
    expect(pasteLinkTab.compareDocumentPosition(topicLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('defaults the language to German when the client profile market is German', () => {
    render(
      <ContentStudioShell
        {...base}
        websiteId="r"
        websiteUrl="https://bakery.de"
        websites={[]}
        clientProfileDefaults={{ audience: null, markets: ['Germany'], languages: ['German', 'English'] }}
      />,
    );
    expect(screen.getByLabelText('Language')).toHaveValue('German');
  });

  it('shows why Generate is disabled when there is no topic', () => {
    render(<ContentStudioShell {...base} websiteId="r" websiteUrl="https://bakery.de" websites={[]} />);
    expect(screen.getByText('Add a topic or pick a source')).toBeInTheDocument();
  });
});

describe('Content Studio website choice', () => {
  it('shows a website picker for a confirmed website', () => {
    render(
      <ContentStudioShell
        {...base}
        websiteId="r"
        websiteUrl="https://bakery.de"
        websites={[{ id: 'r', url: 'https://bakery.de' }, { id: 's', url: 'https://shop.bakery.de' }]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Switch website' })).toBeTruthy();
    expect(screen.queryByText('Add your website first')).toBeNull();
  });

  it('asks for a real website instead of drafting for the sign-up placeholder', () => {
    render(
      <ContentStudioShell {...base} websiteId="p" websiteUrl="https://example-pending-setup.com" websites={[]} websiteConfirmed={false} />,
    );
    expect(screen.getByText('Add your website first')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Switch website' })).toBeNull();
  });
});

describe('Content Studio variants (Phase 2F S3/S2 follow-up)', () => {
  const pieceWithVariants = {
    id: 'piece', platform: 'linkedin' as const, topic: 'Opening hours', status: 'needs_review' as const,
    failureReason: null, draftContent: { body: 'variant 0 body', hashtags: [] }, audience: null, objective: null,
    market: null, language: null, tokenCost: 90, proofChecks: null, createdAt: '2026-10-14T00:00:00.000Z', sourceAction: null,
    variants: [
      { index: 0, angle: 'Direct benefit', draftContent: { body: 'variant 0 body', hashtags: [] }, status: 'needs_review' as const, failureReason: null, tokenCost: 30, proofChecks: null },
      { index: 1, angle: 'Customer story', draftContent: { body: 'variant 1 body', hashtags: [] }, status: 'draft' as const, failureReason: null, tokenCost: 30, proofChecks: null },
      { index: 2, angle: 'Contrarian take', draftContent: {}, status: 'failed' as const, failureReason: 'Provider timeout', tokenCost: 30, proofChecks: null },
    ],
  };

  it('surfaces variants 1 and 2, not just variant 0', () => {
    render(<ContentStudioShell {...base} initialPieces={[pieceWithVariants]} websiteId="r" websiteUrl="https://bakery.de" websites={[]} />);
    expect(screen.getByRole('button', { name: 'Direct benefit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Customer story' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Contrarian take/ })).toBeTruthy();
  });

  it('switches the previewed content when a non-zero variant tab is selected', () => {
    render(<ContentStudioShell {...base} initialPieces={[pieceWithVariants]} websiteId="r" websiteUrl="https://bakery.de" websites={[]} />);
    expect(screen.getByText('variant 0 body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Customer story' }));
    expect(screen.getByText('variant 1 body')).toBeTruthy();
  });

  it('retries the specific failed variant that is selected, not always index 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...pieceWithVariants, variants: pieceWithVariants.variants }) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    render(<ContentStudioShell {...base} initialPieces={[pieceWithVariants]} websiteId="r" websiteUrl="https://bakery.de" websites={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Contrarian take/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ index: 2 });
    globalThis.fetch = originalFetch;
  });
});

describe('Content Studio retry', () => {
  it('retries the variant the draft card shows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'piece', status: 'failed', failureReason: 'Still failing' }) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    const failed = {
      id: 'piece', platform: 'linkedin', topic: 'Opening hours', status: 'failed', failureReason: 'Provider timeout',
      draftContent: {}, audience: null, objective: null, market: null, language: null, tokenCost: 0,
      proofChecks: null, createdAt: '2026-10-14T00:00:00.000Z', sourceAction: null,
    } as const;
    render(
      <ContentStudioShell {...base} initialPieces={[failed]} websiteId="r" websiteUrl="https://bakery.de" websites={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/content-studio/drafts/piece/retry');
    expect(JSON.parse(init.body)).toEqual({ index: 0 });
    await screen.findByText('Still failing');
    globalThis.fetch = originalFetch;
  });
});

describe('Content Studio evidence-source picker (Phase 2G G6)', () => {
  it('shows evidence loaded from the picker and forwards it as sourceEvidenceId on generate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ evidence: { id: 'ev_1', canonicalUrl: 'https://trade-press.test/a', excerpt: 'An excerpt.' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'piece_1', platform: 'linkedin', topic: 'Reacting to a market shift', status: 'draft', failureReason: null,
          draftContent: { body: 'drafted body', hashtags: [] }, audience: null, objective: null, market: null, language: null, tokenCost: 0,
          proofChecks: null, createdAt: '2026-10-14T00:00:00.000Z', sourceAction: null,
        }),
      });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;

    render(<ContentStudioShell {...base} websiteId="r" websiteUrl="https://bakery.de" websites={[]} />);

    fireEvent.change(screen.getByLabelText(/article or page url/i), { target: { value: 'https://trade-press.test/a' } });
    fireEvent.click(screen.getByRole('button', { name: /load evidence/i }));
    await screen.findByText('https://trade-press.test/a');
    expect(screen.getByText('An excerpt.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Reacting to a market shift' } });
    fireEvent.click(screen.getByRole('button', { name: /generate reviewed draft/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body)).toMatchObject({ sourceEvidenceId: 'ev_1' });
    globalThis.fetch = originalFetch;
  });
});
