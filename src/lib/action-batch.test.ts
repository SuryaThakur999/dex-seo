import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionRevision, buildBatchPreviews, parseBatchRequest, decideActionBatch } from './action-batch';
import { db } from './db';
import { listPagePerformance } from './gsc-client';
import { recordEvaluationCase } from './preference-evaluation-events';
import type { ActionWithOwnedWebsiteAndGuard } from './proof-receipt';

vi.mock('./db', () => ({ db: {
  action: { findMany: vi.fn(), update: vi.fn() },
  website: { findUnique: vi.fn() },
  auditLogEntry: { findFirst: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn(async () => [{ id: 'locked' }]),
  $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
} }));
vi.mock('./crypto', () => ({ decrypt: vi.fn(token => token) }));
vi.mock('./gsc-client', async original => ({ ...await original<typeof import('./gsc-client')>(), listPagePerformance: vi.fn() }));
vi.mock('./preference-evaluation-events', () => ({ recordEvaluationCase: vi.fn() }));

describe('decideActionBatch', () => {
  let rows: ActionWithOwnedWebsiteAndGuard[];
  const input = () => ({ customerId: 'customer-1', actorClerkUserId: 'clerk-1', request: {
    ...request(), decision: 'approve' as const,
    items: rows.map(row => ({ actionId: row.id, revision: actionRevision(row) })),
  } });
  beforeEach(() => {
    vi.resetAllMocks();
    rows = [action(), action('action-2')];
    vi.mocked(db.website.findUnique).mockResolvedValue({ ...rows[0].website, gscRefreshToken: 'token', gscPropertyUrl: 'sc-domain:example.com' } as never);
    vi.mocked(db.action.findMany).mockImplementation(() => Promise.resolve(rows) as never);
    vi.mocked(db.auditLogEntry.findFirst).mockResolvedValue(null);
    vi.mocked(db.auditLogEntry.create).mockResolvedValue({} as never);
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: 'locked' }]);
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => callback(db));
    vi.mocked(listPagePerformance).mockResolvedValue([]);
  });

  it('writes one receipt per item and a batch event, then replays without provider or callbacks', async () => {
    const firstInput = input();
    const result = await decideActionBatch(firstInput);
    expect(result.actionIds).toEqual(['action-1', 'action-2']);
    expect(db.action.update).toHaveBeenCalledTimes(2);
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(3);
    const event = vi.mocked(db.auditLogEntry.create).mock.calls[2][0].data;
    vi.mocked(db.auditLogEntry.findFirst).mockResolvedValue({ ...event, id: 'batch-event' } as never);
    rows.forEach(row => { row.status = 'approved'; });
    expect(await decideActionBatch(firstInput)).toEqual(result);
    expect(listPagePerformance).toHaveBeenCalledTimes(1);
    expect(recordEvaluationCase).toHaveBeenCalledTimes(2);
    expect(db.action.update).toHaveBeenCalledTimes(2);
    await expect(decideActionBatch({ ...firstInput, actorClerkUserId: 'another-actor' })).rejects.toMatchObject({ status: 409 });
    expect(listPagePerformance).toHaveBeenCalledTimes(1);
  });

  it.each(['foreign', 'missing', 'site', 'profile'])('rejects %s scope without fetching or writing', async kind => {
    const firstInput = input();
    if (kind === 'foreign') rows[1].customerId = 'other';
    if (kind === 'missing') rows.pop();
    if (kind === 'site') rows[1].websiteId = 'other';
    if (kind === 'profile') rows[1].website.clientProfile.customerId = 'other';
    await expect(decideActionBatch(firstInput)).rejects.toMatchObject({ status: 404 });
    expect(listPagePerformance).not.toHaveBeenCalled();
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it.each(['draft', 'status', 'guard'])('rejects changed %s revisions before fetching', async kind => {
    const firstInput = input();
    if (kind === 'draft') rows[1].draftContent = 'Changed';
    if (kind === 'status') rows[1].status = 'rejected';
    if (kind === 'guard') rows[1].guardResult!.reasoning = 'Changed';
    await expect(decideActionBatch(firstInput)).rejects.toMatchObject({ status: 409 });
    expect(listPagePerformance).not.toHaveBeenCalled();
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('rechecks all items after provider returns and does not partially update', async () => {
    const firstInput = input();
    vi.mocked(listPagePerformance).mockImplementation(async () => { rows[1].draftContent = 'Changed'; return []; });
    await expect(decideActionBatch(firstInput)).rejects.toMatchObject({ status: 409 });
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('rejects without GSC and preserves unavailable baselines', async () => {
    await decideActionBatch({ ...input(), request: { ...input().request, decision: 'reject' } });
    expect(listPagePerformance).not.toHaveBeenCalled();
    expect(db.action.update).toHaveBeenCalledTimes(2);
  });

  it('still commits on provider failure and catches postcommit callback failures', async () => {
    vi.mocked(listPagePerformance).mockRejectedValue(new Error('GSC unavailable'));
    vi.mocked(recordEvaluationCase).mockRejectedValue(new Error('Evaluation unavailable'));
    expect((await decideActionBatch(input())).actionIds).toHaveLength(2);
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(3);
    expect(recordEvaluationCase).toHaveBeenCalledTimes(2);
  });

  it('does not return success or call evaluation when an audit write fails', async () => {
    vi.mocked(db.auditLogEntry.create).mockRejectedValue(new Error('Database failure'));
    await expect(decideActionBatch(input())).rejects.toThrow('Database failure');
    expect(recordEvaluationCase).not.toHaveBeenCalled();
  });

  it('replays reordered items after later undo without fetching or writing again', async () => {
    const firstInput = input();
    const result = await decideActionBatch(firstInput);
    const event = vi.mocked(db.auditLogEntry.create).mock.calls[2][0].data;
    vi.mocked(db.auditLogEntry.findFirst).mockResolvedValue(event as never);
    rows.forEach(row => { row.status = 'pending'; row.decidedAt = null; });
    expect(await decideActionBatch({ ...firstInput, request: { ...firstInput.request, items: [...firstInput.request.items].reverse() } })).toEqual(result);
    expect(listPagePerformance).toHaveBeenCalledTimes(1);
    expect(db.action.update).toHaveBeenCalledTimes(2);
    expect(recordEvaluationCase).toHaveBeenCalledTimes(2);
  });

  it('returns a concurrently committed replay under lock without another callback pass', async () => {
    const firstInput = input();
    const result = await decideActionBatch(firstInput);
    const event = vi.mocked(db.auditLogEntry.create).mock.calls[2][0].data;
    vi.mocked(db.auditLogEntry.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce(event as never);
    expect(await decideActionBatch(firstInput)).toEqual(result);
    expect(db.action.update).toHaveBeenCalledTimes(2);
    expect(db.auditLogEntry.create).toHaveBeenCalledTimes(3);
    expect(recordEvaluationCase).toHaveBeenCalledTimes(2);
  });

  it.each(['customer', 'eventType', 'result', 'website'])('rejects conflicting saved %s before provider reads', async kind => {
    const firstInput = input();
    await decideActionBatch(firstInput);
    const event = JSON.parse(JSON.stringify(vi.mocked(db.auditLogEntry.create).mock.calls[2][0].data));
    if (kind === 'customer') event.customerId = 'other';
    if (kind === 'eventType') event.eventType = 'action_decided';
    if (kind === 'result') event.detail.result.actionIds = ['action-1'];
    if (kind === 'website') event.detail.request.websiteId = 'other-owned-site';
    vi.mocked(db.auditLogEntry.findFirst).mockResolvedValue(event);
    await expect(decideActionBatch(firstInput)).rejects.toMatchObject({ status: 409 });
    expect(listPagePerformance).toHaveBeenCalledTimes(1);
    expect(db.action.update).toHaveBeenCalledTimes(2);
  });

  it.each(['ineligible', 'differentGroup'])('rejects a fresh %s request before provider reads', async kind => {
    if (kind === 'ineligible') rows[1].riskTier = 'high';
    else rows[1].draftContent = 'Different draft';
    await expect(decideActionBatch(input())).rejects.toMatchObject({ status: 400 });
    expect(listPagePerformance).not.toHaveBeenCalled();
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('rechecks website ownership under lock before any write', async () => {
    vi.mocked(db.website.findUnique).mockResolvedValueOnce({ ...rows[0].website } as never).mockResolvedValueOnce(null);
    await expect(decideActionBatch(input())).rejects.toMatchObject({ status: 404 });
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('does not report success or deliver callbacks when the final batch audit fails', async () => {
    vi.mocked(db.auditLogEntry.create).mockResolvedValueOnce({} as never).mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('Batch audit failed'));
    await expect(decideActionBatch(input())).rejects.toThrow('Batch audit failed');
    expect(db.action.update).toHaveBeenCalledTimes(2);
    expect(recordEvaluationCase).not.toHaveBeenCalled();
  });
});

function action(id = 'action-1', overrides: Record<string, unknown> = {}): ActionWithOwnedWebsiteAndGuard {
  return {
    id, customerId: 'customer-1', websiteId: 'website-1', pageUrl: `https://example.com/${id}`,
    actionType: 'meta_description', currentValue: 'Before', draftContent: 'Draft', aiDisclosure: true,
    status: 'pending', generationStatus: 'succeeded', generationError: null, riskTier: 'low', policyVersion: 'v1',
    createdAt: new Date('2026-10-04T12:00:00.000Z'), decidedAt: null, tokenCost: null,
    baselinePerformance: null, baselineCapturedAt: null, outcomePerformance: null, outcomeMeasuredAt: null,
    guardResult: { id: `guard-${id}`, actionId: id, outcome: 'pass', reasoning: 'Checks passed',
      checksRun: [{ check: 'length', result: 'pass', detail: 'Within limit' }] },
    website: { id: 'website-1', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'customer-1' } },
    ...overrides,
  } as unknown as ActionWithOwnedWebsiteAndGuard;
}

const request = () => ({
  requestId: 'ceace7bf-38a0-45a6-932d-bf8ab38023e3', websiteId: 'website-1', decision: 'approve',
  items: [{ actionId: 'action-1', revision: 'a'.repeat(64) }, { actionId: 'action-2', revision: 'b'.repeat(64) }],
});

describe('buildBatchPreviews', () => {
  it('groups identical text across pages with separate item revisions', () => {
    const a = action();
    const b = action('action-2');
    expect(buildBatchPreviews([a, b])).toEqual([{
      groupKey: expect.stringMatching(/^[a-f0-9]{64}$/), websiteId: 'website-1', clientProfileId: 'profile-1',
      sharedCurrentValue: 'Before', sharedDraftContent: 'Draft',
      items: [a, b].map(row => ({ actionId: row.id, pageUrl: row.pageUrl, revision: actionRevision(row) })),
    }]);
    expect(actionRevision(a)).not.toBe(actionRevision(b));
  });

  it.each([
    { draftContent: 'Different' }, { draftContent: 'Draft ' }, { currentValue: 'Different' },
    { currentValue: null }, { aiDisclosure: false }, { policyVersion: 'v2' },
  ])('does not normalize or combine differing fields: %j', overrides => {
    expect(buildBatchPreviews([action(), action('action-2', overrides)])).toEqual([]);
  });

  it.each(['website', 'profile', 'customer'])('keeps different %s owners separate', field => {
    const other = action('action-2');
    if (field === 'website') { other.websiteId = 'website-2'; other.website.id = 'website-2'; }
    if (field === 'profile') { other.website.clientProfileId = 'profile-2'; other.website.clientProfile.id = 'profile-2'; }
    if (field === 'customer') { other.customerId = 'customer-2'; other.website.clientProfile.customerId = 'customer-2'; }
    expect(buildBatchPreviews([action(), other])).toEqual([]);
  });

  it.each([
    { status: 'approved' }, { generationStatus: 'failed' }, { generationStatus: 'pending' },
    { draftContent: '' }, { draftContent: ' \n ' }, { riskTier: 'medium' }, { actionType: 'unknown' },
  ])('excludes ineligible actions: %j', overrides => {
    expect(buildBatchPreviews([action(), action('action-2', overrides)])).toEqual([]);
  });

  it.each([
    null, { outcome: 'flag' }, { outcome: 'block' }, { reasoning: '' }, { checksRun: [] },
    { checksRun: null }, { checksRun: [{ check: 'length', result: 'fail', detail: 'Too long' }] },
    { checksRun: [{ check: 'length', result: 'pass' }] },
    { checksRun: [{ check: '', result: 'pass', detail: 'Within limit' }] },
  ])('excludes malformed or nonpassing guards: %j', overrides => {
    const b = action('action-2');
    b.guardResult = overrides === null ? null : { ...b.guardResult!, ...overrides } as typeof b.guardResult;
    expect(buildBatchPreviews([action(), b])).toEqual([]);
  });

  it.each([
    { reasoning: 'Another reason' },
    { checksRun: [{ check: 'length', result: 'pass', detail: 'Different detail' }] },
  ])('keeps differing guard evidence separate: %j', overrides => {
    const b = action('action-2');
    b.guardResult = { ...b.guardResult!, ...overrides } as typeof b.guardResult;
    expect(buildBatchPreviews([action(), b])).toEqual([]);
  });

  it('sorts object keys but preserves check order', () => {
    const a = action(); const b = action('action-2');
    a.guardResult!.checksRun = [{ check: 'one', result: 'pass', detail: 'First' }, { check: 'two', result: 'pass', detail: 'Second' }];
    b.guardResult!.checksRun = [{ detail: 'First', result: 'pass', check: 'one' }, { detail: 'Second', result: 'pass', check: 'two' }];
    expect(buildBatchPreviews([a, b])).toHaveLength(1);
    b.guardResult!.checksRun = [...b.guardResult!.checksRun as object[]].reverse();
    expect(buildBatchPreviews([a, b])).toEqual([]);
  });

  it('does not offer singleton or duplicate-ID groups', () => {
    expect(buildBatchPreviews([action()])).toEqual([]);
    expect(buildBatchPreviews([action(), action()])).toEqual([]);
  });

  it('caps each preview at 20 distinct items without mutating input', () => {
    const actions = Array.from({ length: 21 }, (_, i) => action(`action-${i}`));
    expect(buildBatchPreviews(actions)[0].items).toHaveLength(20);
    expect(actions).toHaveLength(21);
  });

  it('excludes broken ownership and guard bindings', () => {
    const b = action('action-2'); b.website.clientProfile.customerId = 'different';
    expect(buildBatchPreviews([action(), b])).toEqual([]);
    const c = action('action-3'); c.guardResult!.actionId = 'different';
    expect(buildBatchPreviews([action(), c])).toEqual([]);
  });
});

describe('actionRevision', () => {
  it.each([
    { status: 'rejected' }, { draftContent: 'Changed' }, { generationStatus: 'failed' },
    { pageUrl: 'https://example.com/changed' }, { createdAt: new Date('2026-10-05T12:00:00.000Z') },
    { decidedAt: new Date('2026-10-05T12:00:00.000Z') },
  ])('changes when decision-relevant state changes: %j', overrides => {
    expect(actionRevision(action('action-1', overrides))).not.toBe(actionRevision(action()));
  });
});

describe('parseBatchRequest', () => {
  it.each(['approve', 'reject'])('accepts %s with opaque IDs', decision => {
    const body = { ...request(), decision };
    body.items[0].actionId = 'opaque:command/like';
    expect(parseBatchRequest(body)).toEqual(body);
  });

  it.each([
    null, [], {}, { ...request(), requestId: 'not-uuid' }, { ...request(), decision: 'edit' },
    { ...request(), websiteId: '' }, { ...request(), websiteId: '   ' }, { ...request(), extra: true },
    { ...request(), items: [request().items[0]] },
    { ...request(), items: [request().items[0], request().items[0]] },
    { ...request(), items: [{ actionId: '', revision: 'a'.repeat(64) }, request().items[1]] },
    { ...request(), items: [{ actionId: 'a', revision: 'A'.repeat(64) }, request().items[1]] },
    { ...request(), items: [{ actionId: 'a', revision: 'a'.repeat(63) }, request().items[1]] },
    { ...request(), items: [{ ...request().items[0], extra: true }, request().items[1]] },
    { ...request(), items: Array.from({ length: 21 }, (_, i) => ({ actionId: `a-${i}`, revision: 'a'.repeat(64) })) },
  ])('rejects invalid requests with a typed 400 error: %j', body => {
    expect(() => parseBatchRequest(body)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('measures the 64 KiB limit in UTF-8 bytes', () => {
    const body = { ...request(), websiteId: 'é'.repeat(33_000) };
    expect(() => parseBatchRequest(body)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('accepts the maximum 20-item selection', () => {
    const body = { ...request(), items: Array.from({ length: 20 }, (_, i) => ({ actionId: `a-${i}`, revision: 'a'.repeat(64) })) };
    expect(parseBatchRequest(body)).toEqual(body);
  });
});
