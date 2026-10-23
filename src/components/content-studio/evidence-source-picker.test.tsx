import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvidenceSourcePicker } from './evidence-source-picker';

const fetchMock = vi.fn();

async function settle() {
  await act(async () => {});
}

describe('EvidenceSourcePicker', () => {
  let onEvidenceLoaded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    onEvidenceLoaded = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('defaults to the paste-a-link tab', () => {
    render(<EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />);
    expect(screen.getByLabelText(/article or page url/i)).toBeInTheDocument();
  });

  it('loads evidence from a pasted URL and reports it to the parent', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ evidence: { id: 'ev_1', canonicalUrl: 'https://trade-press.test/a', excerpt: 'An excerpt.' } }) });
    render(<EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />);

    fireEvent.change(screen.getByLabelText(/article or page url/i), { target: { value: 'https://trade-press.test/a' } });
    fireEvent.click(screen.getByRole('button', { name: /load evidence/i }));
    await settle();

    expect(fetchMock).toHaveBeenCalledWith('/api/content-studio/evidence-from-url', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ websiteId: 'site_1', url: 'https://trade-press.test/a' }),
    }));
    expect(onEvidenceLoaded).toHaveBeenCalledWith({ id: 'ev_1', canonicalUrl: 'https://trade-press.test/a', excerpt: 'An excerpt.' });
  });

  it('shows a request failure without silently dropping it', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'That URL could not be read.' }) });
    render(<EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />);

    fireEvent.change(screen.getByLabelText(/article or page url/i), { target: { value: 'https://bad.test' } });
    fireEvent.click(screen.getByRole('button', { name: /load evidence/i }));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('That URL could not be read.');
    expect(onEvidenceLoaded).not.toHaveBeenCalled();
  });

  // Production wires this inside content-studio-shell's own <form onSubmit={handleGenerate}>.
  // A <form> nested inside a <form> is invalid HTML; a browser's HTML parser drops the nested
  // start tag per spec (the form pointer is already set), which desyncs React's hydrated tree
  // from the real DOM and breaks later updates to that subtree, including enabling this button
  // on typing. None of the above tests render inside an outer form, so this regression was
  // invisible until overseer caught it live.
  it('never nests a form inside the outer Generate form it is always mounted in', () => {
    const { container } = render(
      <form>
        <EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />
      </form>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: /pick a video/i }), { button: 0 });
    expect(container.querySelectorAll('form form')).toHaveLength(0);
  });

  it('enables Load evidence as soon as a URL is typed, even mounted inside the outer Generate form', () => {
    render(
      <form>
        <EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />
      </form>,
    );
    const button = screen.getByRole('button', { name: /load evidence/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/article or page url/i), { target: { value: 'https://trade-press.test/a' } });
    expect(button).toBeEnabled();
  });

  it('switches to the pick-a-video tab, lists a channel\'s videos, and loads evidence for the chosen one', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ videos: [{ id: 'vid1', title: 'Video one', publishedAt: '2026-10-01T00:00:00.000Z' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ evidence: { id: 'ev_2', canonicalUrl: 'https://www.youtube.com/watch?v=vid1', excerpt: 'Caption text.' } }) });

    render(<EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /pick a video/i }), { button: 0 });

    fireEvent.change(screen.getByLabelText(/channel url/i), { target: { value: 'https://www.youtube.com/@channel/videos' } });
    fireEvent.click(screen.getByRole('button', { name: /list videos/i }));
    await settle();

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Video one')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: /use this video/i }));
    await settle();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/content-studio/evidence-from-video-list', expect.objectContaining({
      body: JSON.stringify({ websiteId: 'site_1', channelUrl: 'https://www.youtube.com/@channel/videos' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/content-studio/evidence-from-video', expect.objectContaining({
      body: JSON.stringify({ websiteId: 'site_1', videoId: 'vid1' }),
    }));
    expect(onEvidenceLoaded).toHaveBeenCalledWith({ id: 'ev_2', canonicalUrl: 'https://www.youtube.com/watch?v=vid1', excerpt: 'Caption text.' });
  });

  it('mode toggle uses the segmented-control (tab) pattern, not two independent accent buttons', () => {
    render(<EvidenceSourcePicker onEvidenceLoaded={onEvidenceLoaded} />);
    const urlTab = screen.getByRole('tab', { name: 'Paste a link' });
    const videoTab = screen.getByRole('tab', { name: 'Pick a video' });
    expect(urlTab).toHaveAttribute('aria-selected', 'true');
    expect(videoTab).toHaveAttribute('aria-selected', 'false');
  });

  describe('blocked-host paste-text fallback (social-profile-discovery plan, 2026-10-17)', () => {
    it('shows the platform-specific message and a paste-text box as soon as a LinkedIn URL is typed, without a failed request first', () => {
      render(<EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />);
      fireEvent.change(screen.getByLabelText(/article or page url/i), { target: { value: 'https://www.linkedin.com/posts/acme_123' } });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByText(/LinkedIn only shows this page to logged-in users/)).toBeInTheDocument();
      expect(screen.getByLabelText(/paste the post text/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /load evidence/i })).not.toBeInTheDocument();
    });

    it('submitting the pasted text calls evidence-from-text and reports the resulting evidence', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ evidence: { id: 'ev_3', canonicalUrl: 'https://www.linkedin.com/posts/acme_123', excerpt: 'Our launch post.' } }) });
      render(<EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />);
      fireEvent.change(screen.getByLabelText(/article or page url/i), { target: { value: 'https://www.linkedin.com/posts/acme_123' } });
      fireEvent.change(screen.getByLabelText(/paste the post text/i), { target: { value: 'Our launch post.' } });
      fireEvent.click(screen.getByRole('button', { name: /use this text/i }));
      await settle();

      expect(fetchMock).toHaveBeenCalledWith('/api/content-studio/evidence-from-text', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ websiteId: 'site_1', url: 'https://www.linkedin.com/posts/acme_123', text: 'Our launch post.' }),
      }));
      expect(onEvidenceLoaded).toHaveBeenCalledWith({ id: 'ev_3', canonicalUrl: 'https://www.linkedin.com/posts/acme_123', excerpt: 'Our launch post.' });
    });

    it('does not show the fallback for a readable host like ihk.de', () => {
      render(<EvidenceSourcePicker websiteId="site_1" onEvidenceLoaded={onEvidenceLoaded} />);
      fireEvent.change(screen.getByLabelText(/article or page url/i), { target: { value: 'https://ihk.de/some-article' } });
      expect(screen.queryByLabelText(/paste the post text/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /load evidence/i })).toBeInTheDocument();
    });
  });
});
