import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyMission } from './use-daily-mission';

const fetchMock = vi.fn();
function Harness({ websiteId }: { websiteId: string }) {
  const { mission, error } = useDailyMission(websiteId);
  if (error) return <p role="alert">error</p>;
  if (!mission) return <p role="status">loading</p>;
  return <p>{mission.title}</p>;
}

describe('useDailyMission', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('fetches the encoded website id and resolves the mission', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ title: 'Start a New Audit', description: 'd', cta: 'New Scan', ctaHref: '#scan-control', icon: '🚀' }) });
    render(<Harness websiteId="site /?" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/daily-mission?websiteId=site%20%2F%3F', expect.any(Object));
    expect(screen.getByText('Start a New Audit')).toBeInTheDocument();
  });

  it('sets error on a failed fetch', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<Harness websiteId="site_1" />);
    await act(async () => {});
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
