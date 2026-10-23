import { describe, expect, it } from 'vitest';
import type { ActionWithOwnedWebsiteAndGuard, ReceiptEvent, ReceiptSnapshotV1 } from './proof-receipt';
import { actionRevision, buildProofReceipt, buildReceiptSnapshot } from './proof-receipt';

const at = new Date('2026-10-04T12:00:00.000Z');

function action(overrides: Record<string, unknown> = {}): ActionWithOwnedWebsiteAndGuard {
  return {
    id: 'action-1', customerId: 'customer-1', websiteId: 'website-1', pageUrl: 'https://example.com/a',
    actionType: 'meta_description', currentValue: 'Before', draftContent: 'Draft', aiDisclosure: true,
    status: 'edited', generationStatus: 'succeeded', generationError: null, riskTier: 'low', policyVersion: 'v1',
    tokenCost: null, createdAt: at, decidedAt: at, baselinePerformance: null, baselineCapturedAt: null,
    outcomePerformance: null, outcomeMeasuredAt: null,
    guardResult: { id: 'guard-1', actionId: 'action-1', outcome: 'pass', reasoning: 'Checks passed', checksRun: [{ check: 'length', result: 'pass', detail: 'Within limit' }] },
    website: { id: 'website-1', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'customer-1' } },
    ...overrides,
  } as unknown as ActionWithOwnedWebsiteAndGuard;
}

function snapshot(overrides: Partial<ReceiptSnapshotV1> = {}): ReceiptSnapshotV1 {
  return {
    version: 1, actionId: 'action-1', customerId: 'customer-1', clientProfileId: 'profile-1', websiteId: 'website-1',
    pageUrl: 'https://example.com/a', actionType: 'meta_description', currentValue: 'Before',
    preDecisionDraftContent: 'Draft', decidedContent: 'Edited draft', decision: 'edited', actorClerkUserId: 'user-1',
    decidedAt: at.toISOString(), riskTier: 'low', policyVersion: 'v1',
    guard: { outcome: 'pass', reasoning: 'Checks passed', checksRun: [{ check: 'length', result: 'pass', detail: 'Within limit' }] },
    checkedContent: 'unavailable', provenance: { status: 'unavailable' }, ...overrides,
  };
}

function event(receipt = snapshot(), overrides: Partial<ReceiptEvent> = {}): ReceiptEvent {
  return { id: 'event-1', customerId: 'customer-1', actionId: 'action-1', eventType: 'action_decided', createdAt: at.toISOString(), detail: { decision: 'edited', actorClerkUserId: 'user-1', receiptSnapshot: receipt }, ...overrides };
}

describe('buildReceiptSnapshot', () => {
  it.each(['approved', 'edited', 'rejected'] as const)('freezes bytes and guard for %s', (decision) => {
    const source = action();
    const result = buildReceiptSnapshot({ action: source, decision, decidedContent: 'Saved bytes', actorClerkUserId: 'user-1', decidedAt: at });
    expect(result).toMatchObject({ decision, preDecisionDraftContent: 'Draft', decidedContent: 'Saved bytes', checkedContent: 'unavailable', provenance: { status: 'unavailable' } });
    (source.guardResult!.checksRun as { result: string }[])[0].result = 'fail';
    expect(result.guard?.checksRun[0].result).toBe('pass');
  });

  it('records an absent guard as null', () => {
    expect(buildReceiptSnapshot({ action: action({ guardResult: null }), decision: 'rejected', decidedContent: 'Draft', actorClerkUserId: 'u', decidedAt: at }).guard).toBeNull();
  });
});

describe('buildProofReceipt', () => {
  it('uses a valid historical snapshot after the current record changed or was reverted', () => {
    const result = buildProofReceipt({ action: action({ status: 'pending', draftContent: 'Restored bytes', decidedAt: null }), events: [event()] });
    expect(result).toMatchObject({ basis: 'saved_snapshot', snapshot: { decidedContent: 'Edited draft' }, currentRecord: { draftContent: 'Restored bytes' } });
  });

  it('uses current-record fallback when the saved snapshot is missing or malformed', () => {
    const result = buildProofReceipt({ action: action(), events: [event(undefined as never, { detail: { decision: 'edited', receiptSnapshot: null } })] });
    expect(result).toMatchObject({ basis: 'current_record', snapshot: null, limitations: expect.arrayContaining(['Saved receipt does not match its decision record']) });
  });

  it('does not report an ordinary legacy decision without a snapshot as a mismatch', () => {
    const legacy = event(undefined as never, { detail: { decision: 'edited', originalDraftContent: 'Old draft' } });
    const result = buildProofReceipt({ action: action(), events: [legacy] });
    expect(result.basis).toBe('current_record');
    expect(result.limitations).not.toContain('Saved receipt does not match its decision record');
  });

  it('rejects a loaded action whose website ownership chain is inconsistent', () => {
    const ownedAction = action({ website: { id: 'other-website', clientProfileId: 'profile-1', clientProfile: { id: 'profile-1', customerId: 'customer-1' } } });
    expect(buildProofReceipt({ action: ownedAction, events: [event()] }).snapshot).toBeNull();
  });

  it.each([
    ['foreign customer', { customerId: 'other' }], ['null action id', { actionId: null }],
    ['foreign event action', { actionId: 'other' }], ['foreign event customer', { customerId: 'other' }],
  ])('rejects %s event binding', (_label, eventChanges) => {
    const result = buildProofReceipt({ action: action(), events: [event(snapshot(), eventChanges)] });
    expect(result.snapshot).toBeNull();
    expect(result.limitations).toContain('Saved receipt does not match its decision record');
  });

  it.each([
    ['snapshot website', { websiteId: 'foreign' }], ['snapshot client', { clientProfileId: 'foreign' }],
    ['snapshot URL', { pageUrl: 'https://elsewhere.test' }], ['snapshot type', { actionType: 'other' }],
    ['snapshot decision', { decision: 'approved' as const }], ['snapshot actor', { actorClerkUserId: 'other' }],
    ['snapshot time', { decidedAt: '2026-10-04T12:00:01.000Z' }], ['snapshot version', { version: 2 as 1 }],
  ])('rejects mismatched %s', (_label, changes) => {
    const receipt = snapshot(changes as Partial<ReceiptSnapshotV1>);
    const result = buildProofReceipt({ action: action(), events: [event(receipt)] });
    expect(result.snapshot).toBeNull();
  });

  it('sorts valid events by createdAt then id and keeps unknown check labels', () => {
    const older = event(snapshot({ decidedAt: '2026-10-03T12:00:00.000Z' }), { id: 'a', createdAt: '2026-10-03T12:00:00.000Z' });
    const newer = event(snapshot({ decidedAt: at.toISOString(), guard: { outcome: 'pass', reasoning: '', checksRun: [{ check: 'new-check', result: 'pass', detail: 'ok' }] } }), { id: 'z' });
    const result = buildProofReceipt({ action: action(), events: [newer, older] });
    expect(result.snapshot?.guard?.checksRun[0].check).toBe('new-check');
  });

  it('does not trust malformed guard checks or unknown results as passing', () => {
    const malformed = snapshot({ guard: { outcome: 'pass', reasoning: 'x', checksRun: [{ check: 'x', result: 'maybe', detail: 'x' }] } as never });
    const result = buildProofReceipt({ action: action(), events: [event(malformed)] });
    expect(result.snapshot?.guard).toBeNull();
  });

  it('treats empty saved checks as unavailable instead of a passing guard', () => {
    const emptyChecks = snapshot({ guard: { outcome: 'pass', reasoning: 'No checks', checksRun: [] } });
    const result = buildProofReceipt({ action: action(), events: [event(emptyChecks)] });
    expect(result.snapshot?.guard).toBeNull();
  });

  it('treats empty current guard checks as unavailable instead of a passing guard', () => {
    const result = buildProofReceipt({ action: action({ guardResult: { ...action().guardResult!, checksRun: [] } }), events: [] });
    expect(result.currentRecord.guard).toBeNull();
  });

  it('keeps untagged historical metrics unqualified, including zero values', () => {
    const metrics = { impressions: 0, clicks: 0, ctr: 0 };
    const result = buildProofReceipt({ action: action({ baselinePerformance: metrics, baselineCapturedAt: at, outcomePerformance: metrics, outcomeMeasuredAt: at }), events: [event()] });
    expect(result.outcome.availability).toBe('historical_unqualified');
    expect(result.limitations).toContain('Historical GSC values; row availability was not recorded');
  });

  it('accepts only paired metric captures bound to the current decision event', () => {
    const tagged = { impressions: 0, clicks: 0, ctr: 0, captureVersion: 1, availability: 'observed_gsc_row', decisionEventId: 'event-1' };
    const result = buildProofReceipt({ action: action({ status: 'edited', baselinePerformance: tagged, baselineCapturedAt: at, outcomePerformance: tagged, outcomeMeasuredAt: at }), events: [event()] });
    expect(result.outcome.availability).toBe('observed_rows');
    const stale = buildProofReceipt({ action: action({ baselinePerformance: { ...tagged, decisionEventId: 'old-event' }, baselineCapturedAt: at, outcomePerformance: tagged, outcomeMeasuredAt: at }), events: [event()] });
    expect(stale.outcome.availability).toBe('unavailable');
  });

  it('does not infer provenance from same-URL findings or incomplete metric pairs', () => {
    const result = buildProofReceipt({ action: action({ baselinePerformance: { impressions: 5, clicks: 1, ctr: 0.2, captureVersion: 1, availability: 'observed_gsc_row', decisionEventId: 'event-1' }, baselineCapturedAt: at }), events: [event()] });
    expect(result.outcome.availability).toBe('unavailable');
    expect(result.snapshot?.provenance.status).toBe('unavailable');
  });

  it('treats a legacy one-sided metric as unavailable', () => {
    const result = buildProofReceipt({ action: action({ baselinePerformance: { impressions: 1, clicks: 1, ctr: 1 }, baselineCapturedAt: at }), events: [event()] });
    expect(result.outcome.availability).toBe('unavailable');
  });

  it('treats malformed primitive metrics as unavailable', () => {
    const result = buildProofReceipt({ action: action({ baselinePerformance: 0, outcomePerformance: '0' }), events: [] });
    expect(result.outcome.availability).toBe('unavailable');
  });

  it.each([
    ['clicks above impressions', { impressions: 1, clicks: 2, ctr: 0.5 }],
    ['CTR above one', { impressions: 10, clicks: 5, ctr: 1.1 }],
    ['nonzero CTR with no impressions', { impressions: 0, clicks: 0, ctr: 0.5 }],
  ])('rejects %s in tagged captures', (_name, metrics) => {
    const tagged = { ...metrics, captureVersion: 1, availability: 'observed_gsc_row', decisionEventId: 'event-1' };
    const result = buildProofReceipt({ action: action({ baselinePerformance: tagged, baselineCapturedAt: at, outcomePerformance: tagged, outcomeMeasuredAt: at }), events: [event()] });
    expect(result.outcome.availability).toBe('unavailable');
  });

  it.each([
    ['clicks above impressions', { impressions: 1, clicks: 2, ctr: 0.5 }],
    ['CTR above one', { impressions: 10, clicks: 5, ctr: 1.1 }],
    ['nonzero CTR with no impressions', { impressions: 0, clicks: 0, ctr: 0.5 }],
  ])('rejects %s in legacy captures', (_name, metrics) => {
    const result = buildProofReceipt({ action: action({ baselinePerformance: metrics, baselineCapturedAt: at, outcomePerformance: metrics, outcomeMeasuredAt: at }), events: [event()] });
    expect(result.outcome.availability).toBe('unavailable');
  });
});

describe('actionRevision', () => {
  it('returns stable SHA-256 over the exact action and ownership fields', () => {
    const base = action();
    expect(actionRevision(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(actionRevision(base)).toBe(actionRevision({ ...base }));
    expect(actionRevision({ ...base, draftContent: 'Draft ' })).not.toBe(actionRevision(base));
    expect(actionRevision({ ...base, generationError: 'retry failed' })).not.toBe(actionRevision(base));
    expect(actionRevision({ ...base, guardResult: { ...base.guardResult!, reasoning: 'changed' } })).not.toBe(actionRevision(base));
    expect(actionRevision({ ...base, pageUrl: 'https://example.com/b' })).not.toBe(actionRevision(base));
    expect(actionRevision({ ...base, status: 'rejected' })).not.toBe(actionRevision(base));
    expect(actionRevision({ ...base, guardResult: { ...base.guardResult!, checksRun: [{ check: 'other', result: 'pass', detail: 'ok' }] } })).not.toBe(actionRevision(base));
  });
});
