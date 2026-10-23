import React from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealWorkFeed } from './work-feed';

const timestamp = '2026-10-04T01:00:00.000Z';
const fetchMock = vi.fn();
const response = (items: unknown[]) => ({ ok: true, json: async () => items });

async function settle() {
  await act(async () => {});
}

describe('RealWorkFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(response([]));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows loading feedback and requests the encoded website immediately', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<RealWorkFeed websiteId="site /?" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading work feed');
    expect(screen.getByRole('region', { name: 'Work feed' })).toHaveAttribute('id', 'work-feed');
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/work-feed?websiteId=site%20%2F%3F', expect.any(Object));
  });

  it('shows an empty state once a successful request finishes', async () => {
    render(<RealWorkFeed websiteId="site_1" />);
    await settle();

    expect(screen.getByText('No scans yet. Run an audit to start your work feed.')).toBeInTheDocument();
    expect(screen.queryByText('Loading work feed')).not.toBeInTheDocument();
  });

  it('renders every status, finding counts, and the serialized fallback timestamp', async () => {
    const statuses = ['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown'];
    fetchMock.mockResolvedValue(response(statuses.map((status, index) => ({
      scanId: `scan_${index}`, timestamp, status, findingCount: index === 0 ? 1 : 2,
      findings: [],
    }))));
    render(<RealWorkFeed websiteId="site_1" />);
    await settle();

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(6);
    statuses.forEach((status, index) => {
      expect(within(rows[index]).getByText(status[0].toUpperCase() + status.slice(1))).toBeInTheDocument();
      const date = rows[index].querySelector('time');
      expect(date).toHaveAttribute('dateTime', timestamp);
      expect(date).toHaveTextContent(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp)));
    });
    expect(within(rows[0]).getByText('1 finding')).toBeInTheDocument();
    expect(within(rows[1]).getByText('2 findings')).toBeInTheDocument();
  });

  it('shows the top 3 findings under the badge, plain-language ruleId, not empty', async () => {
    fetchMock.mockResolvedValue(response([{
      scanId: 'scan_1', timestamp, status: 'completed', findingCount: 5,
      findings: [
        { id: 'f1', ruleId: 'missing_canonical', severity: 'high' },
        { id: 'f2', ruleId: 'duplicate_title', severity: 'medium' },
        { id: 'f3', ruleId: 'missing_meta_description', severity: 'low' },
        { id: 'f4', ruleId: 'should_not_render', severity: 'low' },
      ],
    }]));
    render(<RealWorkFeed websiteId="site_1" />);
    await settle();

    expect(screen.getByText('Missing canonical')).toBeInTheDocument();
    expect(screen.getByText('Duplicate title')).toBeInTheDocument();
    expect(screen.getByText('Missing meta description')).toBeInTheDocument();
    expect(screen.queryByText('Should not render')).not.toBeInTheDocument();
  });

  it('renders no findings list when a scan has none', async () => {
    fetchMock.mockResolvedValue(response([{ scanId: 'scan_1', timestamp, status: 'completed', findingCount: 0, findings: [] }]));
    render(<RealWorkFeed websiteId="site_1" />);
    await settle();

    expect(screen.getByRole('listitem').querySelector('ul')).toBeNull();
  });

  it('polls every 30 seconds and stops after unmount', async () => {
    const { unmount } = render(<RealWorkFeed websiteId="site_1" />);
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a request failure and recovers on the next poll', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    render(<RealWorkFeed websiteId="site_1" />);
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the work feed. We'll try again shortly.");
    expect(screen.queryByText(/No scans yet/)).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/No scans yet/)).toBeInTheDocument();
  });

  it('clears the old site data and ignores its late response after a site switch', async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const { rerender } = render(<RealWorkFeed websiteId="old_site" />);
    rerender(<RealWorkFeed websiteId="new_site" />);
    await settle();
    await act(async () => {
      resolveOld(response([{ scanId: 'old', timestamp, status: 'completed', findingCount: 7, findings: [] }]));
    });

    expect(screen.queryByText('7 findings')).not.toBeInTheDocument();
    expect(screen.getByText(/No scans yet/)).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/dashboard/work-feed?websiteId=new_site', expect.any(Object));
  });
});
