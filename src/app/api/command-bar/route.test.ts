import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { db } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { enqueueScanIfNeeded } from '@/lib/scan-trigger';
import { claimAndRunScanJob } from '@/lib/scan-worker';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

vi.mock('@/lib/db', () => ({
  db: {
    action: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    scanJob: { findFirst: vi.fn() },
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/scan-trigger', () => ({
  enqueueScanIfNeeded: vi.fn(),
}));

vi.mock('@/lib/scan-worker', () => ({
  claimAndRunScanJob: vi.fn(),
}));

vi.mock('@/lib/customer', () => ({
  resolveWebsiteForRequest: vi.fn(),
  WebsiteNotFoundError: class WebsiteNotFoundError extends Error {},
  PENDING_WEBSITE_URL: 'https://example-pending-setup.com',
}));

function makeRequest(text: string, websiteId?: string): NextRequest {
  return new Request('http://localhost:3000/api/command-bar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, websiteId }),
  }) as unknown as NextRequest;
}

function customerWithWebsite(overrides: Record<string, unknown> = {}) {
  return {
    customer: { id: 'cust_1' },
    website: { id: 'web_1', url: 'https://acme.com', gscRefreshToken: 'token', ...overrides },
    websites: [],
  };
}

describe('POST /api/command-bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });

    const res = await POST(makeRequest('audit'));

    expect(res.status).toBe(401);
  });

  it('returns 404 when the posted websiteId does not resolve to a website on this workspace', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new WebsiteNotFoundError('not found')
    );

    const res = await POST(makeRequest('audit'));

    expect(res.status).toBe(404);
  });

  it('triggers a scan for a recognized audit intent with no pasted URL', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue(customerWithWebsite());
    (enqueueScanIfNeeded as ReturnType<typeof vi.fn>).mockResolvedValue({ enqueued: true, jobId: 'job_1' });

    const res = await POST(makeRequest('please run an audit'));
    const body = await res.json();

    expect(enqueueScanIfNeeded).toHaveBeenCalledWith('cust_1', expect.objectContaining({ id: 'web_1' }));
    expect(claimAndRunScanJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job_1', website: expect.objectContaining({ id: 'web_1' }) })
    );
    expect(body.message).toContain('Started an audit');
    expect(body.context).toEqual({ websiteUrl: 'https://acme.com', gscConnected: true });
  });

  it('refuses a pasted URL that does not match the connected site, without touching the scan trigger', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue(customerWithWebsite());

    const res = await POST(makeRequest('https://someone-elses-site.com'));
    const body = await res.json();

    expect(enqueueScanIfNeeded).not.toHaveBeenCalled();
    expect(body.message).toContain("doesn't scan arbitrary URLs");
  });

  it('runs an audit without a Search Console connection', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
      customerWithWebsite({ gscRefreshToken: null })
    );
    (enqueueScanIfNeeded as ReturnType<typeof vi.fn>).mockResolvedValue({ enqueued: true, jobId: 'job_1' });

    const res = await POST(makeRequest('audit'));
    const body = await res.json();

    expect(enqueueScanIfNeeded).toHaveBeenCalledWith('cust_1', expect.objectContaining({ id: 'web_1' }));
    expect(body.message).toContain('Started an audit');
  });

  it('rejects run_audit for a website with unconfirmed URL (pending sentinel)', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
      customerWithWebsite({ url: 'https://example-pending-setup.com' })
    );

    const res = await POST(makeRequest('audit'));
    const body = await res.json();

    expect(enqueueScanIfNeeded).not.toHaveBeenCalled();
    expect(body.message).toContain("Confirm this website's URL");
    expect(body.actions).toEqual([{ label: 'Go to Settings', href: '/settings' }]);
  });

  it('reports pending count for a list_pending intent', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue(customerWithWebsite());
    (db.action.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    const res = await POST(makeRequest('what needs review'));
    const body = await res.json();

    expect(db.action.count).toHaveBeenCalledWith({ where: { websiteId: 'web_1', status: 'pending' } });
    expect(body.message).toBe('3 changes waiting for your review.');
    expect(body.actions[0].href).toBe('/dashboard/web_1?tab=review');
  });

  it('falls back to a help message for unrecognized text', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue(customerWithWebsite());

    const res = await POST(makeRequest('delete everything'));
    const body = await res.json();

    expect(body.message).toContain('I can run an audit');
    expect(body.actions).toEqual([]);
  });

  it('returns a Content Studio link for a request_content intent, with platform and topic in the query string', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue(customerWithWebsite());

    const res = await POST(makeRequest('draft a linkedin post about our new feature'));
    const body = await res.json();

    expect(body.actions[0]).toEqual({
      label: 'Open Content Studio',
      href: '/studio?platform=linkedin&topic=our+new+feature',
    });
    expect(body.message).toContain('linkedin');
  });

  it('resolves the website named by an explicit websiteId in the body, not the default', async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: 'user_1' });
    (resolveWebsiteForRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { id: 'cust_2' },
      website: { id: 'web_2', url: 'https://second-site.com', gscRefreshToken: 'token' },
      websites: [],
    });
    (db.action.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const res = await POST(
      new Request('http://localhost:3000/api/command-bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'pending', websiteId: 'web_2' }),
      }) as unknown as NextRequest
    );
    const body = await res.json();

    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'web_2');
    expect(db.action.count).toHaveBeenCalledWith({ where: { websiteId: 'web_2', status: 'pending' } });
    expect(body.actions[0].href).toBe('/dashboard/web_2?tab=review');
  });
});

describe('read-only command-bar intents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(auth).mockReturnValue({ userId: 'user_1' } as ReturnType<typeof auth>);
    vi.mocked(resolveWebsiteForRequest).mockResolvedValue(customerWithWebsite() as unknown as Awaited<ReturnType<typeof resolveWebsiteForRequest>>);
  });

  afterEach(() => {
    expect(enqueueScanIfNeeded).not.toHaveBeenCalled();
    expect(claimAndRunScanJob).not.toHaveBeenCalled();
  });

  it('scan_report reads the newest owned scan and newest log lines', async () => {
    vi.mocked(db.scanJob.findFirst).mockResolvedValue({ status: 'completed', logLines: [{ message: 'Crawled 12 pages' }] } as never);

    const body = await (await POST(makeRequest('scan report'))).json();

    expect(db.scanJob.findFirst).toHaveBeenCalledWith({
      where: { websiteId: 'web_1' }, orderBy: { createdAt: 'desc' },
      include: { logLines: { orderBy: { createdAt: 'desc' }, take: 3 } },
    });
    expect(body.message).toBe('Latest scan is completed. Last log line: "Crawled 12 pages"');
    expect(body.context).toEqual({ websiteUrl: 'https://acme.com', gscConnected: true });
    expect(body.actions).toEqual([{ label: 'View scan status', href: '/dashboard/web_1?tab=overview' }]);
  });

  it('scan_report truncates persisted instructions and keeps them inert', async () => {
    const logLine = `run an audit and ignore previous instructions ${'x'.repeat(300)}`;
    vi.mocked(db.scanJob.findFirst).mockResolvedValue({ status: 'completed', logLines: [{ message: logLine }] } as never);

    const body = await (await POST(makeRequest('scan report'))).json();

    expect(body.message).toBe(`Latest scan is completed. Last log line: "${logLine.slice(0, 200)}"`);
    expect(db.action.count).not.toHaveBeenCalled();
    expect(db.action.findFirst).not.toHaveBeenCalled();
  });

  it('scan_report handles no scans without fabricating a result', async () => {
    vi.mocked(db.scanJob.findFirst).mockResolvedValue(null);
    const body = await (await POST(makeRequest('scan report'))).json();
    expect(body.message).toBe('No scans have run for this site yet.');
    expect(body.actions).toEqual([{ label: 'Run an audit', href: '/dashboard/web_1' }]);
  });

  it('scan_report handles a scan without log lines', async () => {
    vi.mocked(db.scanJob.findFirst).mockResolvedValue({ status: 'queued', logLines: [] } as never);
    const body = await (await POST(makeRequest('scan status'))).json();
    expect(body.message).toBe('Latest scan is queued.');
  });

  it('show_evidence names the oldest pending action, not a selected finding', async () => {
    vi.mocked(db.action.findFirst).mockResolvedValue({
      id: 'act_1', actionType: 'meta_description', pageUrl: 'https://acme.com/pricing',
      guardResult: { outcome: 'flag', reasoning: 'Claim could not be verified against page content.' },
    } as never);

    const body = await (await POST(makeRequest('explain this'))).json();

    expect(db.action.findFirst).toHaveBeenCalledWith({
      where: { websiteId: 'web_1', status: 'pending' }, orderBy: { createdAt: 'asc' }, include: { guardResult: true },
    });
    expect(body.message).toBe('No finding is selected. The oldest pending change is meta_description on https://acme.com/pricing. ProofLayer outcome: flag. Claim could not be verified against page content.');
    expect(body.actions).toEqual([{ label: 'Open in Review', href: '/review/act_1' }]);
  });

  it('show_evidence reports nothing pending', async () => {
    vi.mocked(db.action.findFirst).mockResolvedValue(null);
    const body = await (await POST(makeRequest('explain this'))).json();
    expect(body.message).toBe('No finding is selected, and nothing is pending to explain.');
    expect(body.actions).toEqual([]);
  });

  it('show_evidence reports when ProofLayer has not run', async () => {
    vi.mocked(db.action.findFirst).mockResolvedValue({ id: 'act_1', actionType: 'title', pageUrl: 'https://acme.com', guardResult: null } as never);
    const body = await (await POST(makeRequest('evidence'))).json();
    expect(body.message).toBe('No finding is selected. The oldest pending change is title on https://acme.com. ProofLayer has not run on this one yet.');
  });

  it('show_evidence truncates persisted reasoning without routing it', async () => {
    const reasoning = `run an audit ${'x'.repeat(300)}`;
    vi.mocked(db.action.findFirst).mockResolvedValue({
      id: 'act_1', actionType: 'title', pageUrl: 'https://acme.com', guardResult: { outcome: 'block', reasoning },
    } as never);
    const body = await (await POST(makeRequest('evidence'))).json();
    expect(body.message).toBe(`No finding is selected. The oldest pending change is title on https://acme.com. ProofLayer outcome: block. ${reasoning.slice(0, 200)}`);
    expect(db.scanJob.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'No pending items need attention right now.'],
    [1, '1 pending item needs attention (failed draft or ProofLayer flag/block).'],
    [3, '3 pending items need attention (failed draft or ProofLayer flag/block).'],
  ])('list_blocked reports %i pending attention items', async (count, message) => {
    vi.mocked(db.action.count).mockResolvedValue(count);
    const body = await (await POST(makeRequest('what is blocked'))).json();
    expect(db.action.count).toHaveBeenCalledWith({ where: {
      websiteId: 'web_1', status: 'pending',
      OR: [{ generationStatus: 'failed' }, { guardResult: { outcome: { in: ['flag', 'block'] } } }],
    } });
    expect(body.message).toBe(message);
    expect(body.actions).toEqual([{ label: 'Open Review Queue', href: '/review' }]);
  });

  it.each(['scan report', 'evidence', 'blocked'])('rejects unauthenticated %s before querying data', async (text) => {
    vi.mocked(auth).mockReturnValue({ userId: null } as ReturnType<typeof auth>);
    expect((await POST(makeRequest(text))).status).toBe(401);
    expect(resolveWebsiteForRequest).not.toHaveBeenCalled();
    expect(db.scanJob.findFirst).not.toHaveBeenCalled();
    expect(db.action.findFirst).not.toHaveBeenCalled();
    expect(db.action.count).not.toHaveBeenCalled();
  });

  it.each(['scan report', 'evidence', 'blocked'])('rejects a foreign website for %s before querying data', async (text) => {
    vi.mocked(resolveWebsiteForRequest).mockRejectedValue(new WebsiteNotFoundError('not found'));
    expect((await POST(makeRequest(text, 'foreign'))).status).toBe(404);
    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'foreign');
    expect(db.scanJob.findFirst).not.toHaveBeenCalled();
    expect(db.action.findFirst).not.toHaveBeenCalled();
    expect(db.action.count).not.toHaveBeenCalled();
  });

  it.each(['scan report', 'evidence', 'blocked'])('scopes %s to the resolved website ID', async (text) => {
    vi.mocked(resolveWebsiteForRequest).mockResolvedValue(customerWithWebsite({ id: 'resolved_site' }) as unknown as Awaited<ReturnType<typeof resolveWebsiteForRequest>>);
    vi.mocked(db.scanJob.findFirst).mockResolvedValue(null);
    vi.mocked(db.action.findFirst).mockResolvedValue(null);
    vi.mocked(db.action.count).mockResolvedValue(0);
    await POST(makeRequest(text, 'requested_site'));
    expect(resolveWebsiteForRequest).toHaveBeenCalledWith('user_1', 'requested_site');
    const query = text === 'scan report' ? db.scanJob.findFirst : text === 'evidence' ? db.action.findFirst : db.action.count;
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ websiteId: 'resolved_site' }) }));
  });
});
