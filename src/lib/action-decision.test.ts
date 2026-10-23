import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { listPagePerformance, GoogleAuthError } from '@/lib/gsc-client';
import { actionRevision, buildReceiptSnapshot, type ActionWithOwnedWebsiteAndGuard } from './proof-receipt';
import { ActionDecisionError, decideAction } from './action-decision';

vi.mock('@/lib/db', () => ({
  db: {
    action: { findUnique: vi.fn(), update: vi.fn() },
    auditLogEntry: { create: vi.fn(), findMany: vi.fn() },
    website: { updateMany: vi.fn() },
    $queryRaw: vi.fn(async () => [{ id: 'locked' }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  },
}));

vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn((token: string) => `decrypted-${token}`) }));
vi.mock('@/lib/gsc-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gsc-client')>();
  return { ...actual, listPagePerformance: vi.fn() };
});
vi.mock('@/lib/preference-evaluation-events', () => ({ recordEvaluationCase: vi.fn() }));

const NOW = new Date('2026-10-04T12:00:00.000Z');

function makeAction(overrides: Record<string, unknown> = {}): ActionWithOwnedWebsiteAndGuard {
  return {
    id: 'action-1', customerId: 'customer-1', websiteId: 'website-1', pageUrl: 'https://example.com/a',
    actionType: 'meta_description', currentValue: 'Old', draftContent: 'Draft', aiDisclosure: true,
    status: 'pending', generationStatus: 'succeeded', generationError: null, riskTier: 'low', policyVersion: 'v1',
    tokenCost: null, createdAt: NOW, decidedAt: null, baselinePerformance: null, baselineCapturedAt: null,
    outcomePerformance: null, outcomeMeasuredAt: null,
    guardResult: { id: 'guard-1', actionId: 'action-1', outcome: 'pass', reasoning: 'Looks safe', checksRun: [{ check: 'length', result: 'pass', detail: 'Within limit' }] },
    website: { id: 'website-1', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'customer-1', websites: [] } },
    ...overrides,
  } as unknown as ActionWithOwnedWebsiteAndGuard;
}

function setup(action = makeAction()) {
  (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(action);
  (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (db.auditLogEntry.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (db.action.update as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...action, ...data }));
  return action;
}

describe('decideAction', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(['approve', 'reject'] as const)('refuses %s without the displayed revision', async (decision) => {
    const action = setup();
    await expect(decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, decision }))
      .rejects.toMatchObject({ status: 409 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it.each(['approve', 'reject'] as const)('refuses %s when the displayed draft changed but status is still pending', async (decision) => {
    const displayed = makeAction();
    setup(makeAction({ draftContent: 'Replacement draft' }));
    await expect(decideAction({ customerId: displayed.customerId, actorClerkUserId: 'u', actionId: displayed.id, decision, expectedRevision: actionRevision(displayed) }))
      .rejects.toMatchObject({ status: 409 });
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('refuses approval without a valid non-block guard', async () => {
    const action = setup(makeAction({ guardResult: null }));
    await expect(decideAction({ customerId: action.customerId, actorClerkUserId: 'clerk-user', actionId: action.id, expectedRevision: actionRevision(action), decision: 'approve' }))
      .rejects.toMatchObject({ status: 400 });
    expect(db.action.update).not.toHaveBeenCalled();
    expect(db.auditLogEntry.create).not.toHaveBeenCalled();
  });

  it.each([
    ['failed generation', { generationStatus: 'failed' }],
    ['blank draft', { draftContent: '  ' }],
    ['block outcome', { guardResult: { id: 'guard-1', actionId: 'action-1', outcome: 'block', reasoning: 'Blocked', checksRun: [{ check: 'x', result: 'fail', detail: 'blocked' }] } }],
    ['empty checks', { guardResult: { id: 'guard-1', actionId: 'action-1', outcome: 'pass', reasoning: 'No checks', checksRun: [] } }],
  ])('rejects approval for %s', async (_name, changes) => {
    const action = setup(makeAction(changes));
    await expect(decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, expectedRevision: actionRevision(action), decision: 'approve' }))
      .rejects.toMatchObject({ status: 400 });
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('rejects foreign customer or mismatched website owner before transaction', async () => {
    const action = setup(makeAction({ website: { id: 'website-1', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'foreign' } } }));
    await expect(decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, expectedRevision: actionRevision(action), decision: 'reject' }))
      .rejects.toMatchObject({ status: 404 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('writes one decision snapshot and audit event under customer, website, action locks', async () => {
    const action = setup();
    await decideAction({ customerId: action.customerId, actorClerkUserId: 'clerk-user', actionId: action.id, expectedRevision: actionRevision(action), decision: 'edit', draftContent: 'Edited draft' });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function));
    const locks = (db.$queryRaw as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => query);
    const lockQueries = locks.map((query) => query.strings.join(''));
    expect(lockQueries.map((sql) => sql.match(/FROM "(Customer|Website|Action)"/)?.[1])).toEqual(['Customer', 'Website', 'Action']);
    expect(locks.map((query) => query.values)).toEqual([['customer-1'], ['website-1'], ['action-1']]);
    const update = (db.action.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const audit = (db.auditLogEntry.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(update.data).toMatchObject({ status: 'edited', draftContent: 'Edited draft' });
    expect(audit.detail.receiptSnapshot).toMatchObject({ preDecisionDraftContent: 'Draft', decidedContent: 'Edited draft', actorClerkUserId: 'clerk-user' });
    expect(audit.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.createdAt).toEqual(update.data.decidedAt);
    expect(audit.detail.receiptSnapshot.decidedAt).toBe(audit.createdAt.toISOString());
  });

  it('rejects a stale revision before provider work', async () => {
    const action = setup();
    await expect(decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, decision: 'approve', expectedRevision: '0'.repeat(64) }))
      .rejects.toMatchObject({ status: 409 });
    expect(listPagePerformance).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rechecks the revision after delayed GSC work', async () => {
    const action = setup(makeAction({ website: { id: 'website-1', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'customer-1' }, gscRefreshToken: 'cipher', gscPropertyUrl: 'sc-domain:example.com', gscReconnectRequired: false } }));
    let finishFetch!: (rows: { url: string; impressions: number; clicks: number; ctr: number }[]) => void;
    (listPagePerformance as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((resolve) => { finishFetch = resolve; }));
    const pending = decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, decision: 'approve', expectedRevision: actionRevision(action) });
    await vi.waitFor(() => expect(listPagePerformance).toHaveBeenCalledOnce());
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...action, status: 'rejected', decidedAt: NOW });
    finishFetch([{ url: action.pageUrl, impressions: 0, clicks: 0, ctr: 0 }]);
    await expect(pending).rejects.toBeInstanceOf(ActionDecisionError);
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('keeps approval successful but leaves a missing GSC row unmeasured', async () => {
    const action = setup(makeAction({ website: { id: 'website-1', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'customer-1' }, gscRefreshToken: 'cipher', gscPropertyUrl: 'sc-domain:example.com', gscReconnectRequired: false } }));
    (listPagePerformance as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, expectedRevision: actionRevision(action), decision: 'approve' });
    expect(db.action.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ baselinePerformance: Prisma.DbNull, baselineCapturedAt: null }) }));
  });

  it('flags only confirmed dead GSC credentials and still records the decision', async () => {
    const action = setup(makeAction({ website: { id: 'website-1', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'customer-1' }, gscRefreshToken: 'cipher', gscPropertyUrl: 'sc-domain:example.com', gscReconnectRequired: false } }));
    (listPagePerformance as ReturnType<typeof vi.fn>).mockRejectedValue(new GoogleAuthError('expired'));
    await decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, expectedRevision: actionRevision(action), decision: 'approve' });
    expect(db.website.updateMany).toHaveBeenCalledWith({ where: { id: 'website-1', gscRefreshToken: 'cipher' }, data: { gscReconnectRequired: true } });
    expect(db.auditLogEntry.create).toHaveBeenCalledOnce();
  });

  it('returns 409 when the action state changes before the locked read', async () => {
    const action = setup();
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(action).mockResolvedValueOnce({ ...action, status: 'rejected', decidedAt: NOW });
    await expect(decideAction({ customerId: action.customerId, actorClerkUserId: 'u', actionId: action.id, expectedRevision: actionRevision(action), decision: 'reject' }))
      .rejects.toMatchObject({ status: 409 });
    expect(db.action.update).not.toHaveBeenCalled();
  });

  it('reverts an edited draft from its validated receipt snapshot', async () => {
    const action = setup(makeAction({ status: 'edited', draftContent: 'Edited draft', decidedAt: NOW }));
    const snapshot = buildReceiptSnapshot({ action: makeAction(), decision: 'edited', decidedContent: 'Edited draft', actorClerkUserId: 'clerk-user', decidedAt: NOW });
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'decision-event', customerId: action.customerId, actionId: action.id, eventType: 'action_decided', createdAt: NOW,
      detail: { decision: 'edited', actorClerkUserId: 'clerk-user', receiptSnapshot: snapshot },
    }]);

    await decideAction({ customerId: action.customerId, actorClerkUserId: 'clerk-user', actionId: action.id, expectedRevision: actionRevision(action), decision: 'revert' });

    expect(db.action.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending', draftContent: 'Draft', baselinePerformance: Prisma.DbNull }) }));
  });

  it('uses only the current legacy edit event when no receipt snapshot exists', async () => {
    const action = setup(makeAction({ status: 'edited', draftContent: 'Edited draft', decidedAt: NOW }));
    (db.auditLogEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'legacy-event', customerId: action.customerId, actionId: action.id, eventType: 'action_decided', createdAt: NOW,
      detail: { decision: 'edited', originalDraftContent: 'Legacy draft' },
    }]);

    await decideAction({ customerId: action.customerId, actorClerkUserId: 'clerk-user', actionId: action.id, expectedRevision: actionRevision(action), decision: 'revert' });

    expect(db.action.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftContent: 'Legacy draft' }) }));
  });
});
