import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  clientProfile: { findFirst: vi.fn() }, website: { findFirst: vi.fn() },
  action: { findMany: vi.fn() }, contentPiece: { findMany: vi.fn() },
  preferenceCandidate: { findMany: vi.fn() }, preferenceEvaluation: { findMany: vi.fn() },
}));
vi.mock('./db', () => ({ db: mocks }));
import { loadDecisionInbox } from './decision-inbox';

const profile = { id: 'cp_1', customerId: 'owner', name: 'Client One', isDefault: true, restrictedWording: ['active'] };
const site = { id: 'site_1', clientProfileId: 'cp_1', url: 'https://one.test', clientProfile: profile };
const date = new Date('2026-10-04T00:00:00Z');
const guard = { outcome: 'pass', reasoning: 'Checked', checksRun: [{ check: 'policy', result: 'pass', detail: 'OK' }] };
function action(id: string, overrides = {}) {
  return { id, customerId: 'owner', websiteId: 'site_1', website: site, pageUrl: `https://one.test/${id}`,
    actionType: 'meta_description', status: 'pending', generationStatus: 'succeeded', guardResult: guard, createdAt: date,
    provenanceRecords: [], ...overrides };
}
function causalFinding(resolution: string | null) {
  return { finding: { id: `f_${resolution ?? 'open'}`, ruleId: 'missing_canonical', resolution } };
}
function candidate(id: string, overrides = {}) {
  return { id, clientProfileId: 'cp_1', websiteId: 'site_1', clientProfile: profile, website: site,
    originalProposedPhrase: 'phrase', status: 'proposed', generatedAt: date, evaluation: null, ...overrides };
}
function piece(id: string, overrides = {}) {
  return { id, clientProfileId: 'cp_1', clientProfile: profile, sourceActionId: null, sourceAction: null,
    status: 'needs_review', topic: 'Review this content', createdAt: date, ...overrides };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.clientProfile.findFirst.mockResolvedValue(profile);
  mocks.website.findFirst.mockResolvedValue(site);
  for (const model of [mocks.action, mocks.contentPiece, mocks.preferenceCandidate, mocks.preferenceEvaluation]) model.findMany.mockResolvedValue([]);
});

describe('loadDecisionInbox', () => {
  it('rejects a foreign website without loading any rows', async () => {
    mocks.website.findFirst.mockResolvedValue(null);
    await expect(loadDecisionInbox({ customerId: 'owner', websiteId: 'foreign' })).rejects.toMatchObject({ status: 404 });
    expect(mocks.action.findMany).not.toHaveBeenCalled();
    expect(mocks.website.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'foreign', clientProfile: { customerId: 'owner' } }) }));
  });
  it('rejects a foreign client and an owned client paired with another client website', async () => {
    mocks.clientProfile.findFirst.mockResolvedValueOnce(null);
    await expect(loadDecisionInbox({ customerId: 'owner', clientProfileId: 'foreign' })).rejects.toMatchObject({ status: 404 });
    mocks.website.findFirst.mockResolvedValue({ ...site, clientProfileId: 'cp_2' });
    await expect(loadDecisionInbox({ customerId: 'owner', clientProfileId: 'cp_1', websiteId: 'site_2' })).rejects.toMatchObject({ status: 404 });
  });
  it('uses customer and relational scope on action reads, including nondefault clients', async () => {
    mocks.clientProfile.findFirst.mockResolvedValue({ ...profile, id: 'cp_2', isDefault: false });
    await loadDecisionInbox({ customerId: 'owner', clientProfileId: 'cp_2' });
    expect(mocks.clientProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cp_2', customerId: 'owner' } }));
    for (const [query] of mocks.action.findMany.mock.calls) {
      expect(query.where).toMatchObject({ customerId: 'owner', website: { clientProfileId: 'cp_2', clientProfile: { customerId: 'owner' } } });
      expect(query.take).toBe(101);
      expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    }
  });
  it('keeps flags, blocks, failed generation, unavailable proof and human rejection distinct', async () => {
    mocks.action.findMany.mockImplementation(async ({ where }) => where.status === 'pending' ? [
      action('pass'), action('flag', { guardResult: { ...guard, outcome: 'flag' } }),
      action('block', { guardResult: { ...guard, outcome: 'block' } }),
      action('failed', { generationStatus: 'failed' }), action('missing', { guardResult: null }),
      action('invalid', { guardResult: { ...guard, checksRun: {} } }),
    ] : where.status === 'rejected' ? [action('rejected', { status: 'rejected' })]
      : where.status === 'approved' ? [action('approved', { status: 'approved' })]
        : [action('edited', { status: 'edited' })]);
    const { rows } = await loadDecisionInbox({ customerId: 'owner' });
    expect(Object.fromEntries(rows.map(r => [r.id, r.state]))).toEqual({ pass: 'needs_decision', flag: 'needs_decision', block: 'blocked_or_failed', failed: 'blocked_or_failed', missing: 'blocked_or_failed', invalid: 'blocked_or_failed', rejected: 'history', approved: 'ready_to_apply', edited: 'ready_to_apply' });
    expect(rows.find(r => r.id === 'missing')?.unavailableReason).toBe('Proof check unavailable');
    expect(rows.find(r => r.id === 'failed')?.unavailableReason).toBe('Generation failed');
  });
  it('hides a pending action whose causal findings were all resolved on rescan, without touching ones still open or with no causal findings', async () => {
    mocks.action.findMany.mockImplementation(async ({ where }) => where.status === 'pending' ? [
      action('all_fixed', { provenanceRecords: [{ findings: [causalFinding('fixed'), causalFinding('excluded')] }] }),
      action('still_open', { provenanceRecords: [{ findings: [causalFinding('fixed'), causalFinding(null)] }] }),
      action('no_provenance'),
    ] : []);
    const { rows } = await loadDecisionInbox({ customerId: 'owner' });
    expect(rows.map(r => r.id)).toEqual(expect.arrayContaining(['still_open', 'no_provenance']));
    expect(rows.map(r => r.id)).not.toContain('all_fixed');
  });
  it('keeps two owned clients and their websites separate without default-client fallback', async () => {
    const secondProfile = { ...profile, id: 'cp_2', name: 'Client Two', isDefault: false };
    const secondSite = { ...site, id: 'site_2', clientProfileId: 'cp_2', url: 'https://two.test', clientProfile: secondProfile };
    const secondAction = action('second_action', { websiteId: secondSite.id, website: secondSite });
    mocks.clientProfile.findFirst.mockImplementation(async ({ where }) => where.id === profile.id ? profile : secondProfile);
    mocks.website.findFirst.mockImplementation(async ({ where }) => where.id === site.id ? site : secondSite);
    mocks.action.findMany.mockImplementation(async ({ where }) => where.status === 'pending' ? [action('first_action'), secondAction] : []);
    mocks.contentPiece.findMany.mockImplementation(async ({ where }) => where.status === 'needs_review' ? [
      piece('first_content', { sourceActionId: 'first_action', sourceAction: action('first_action') }),
      piece('second_content', { clientProfileId: secondProfile.id, clientProfile: secondProfile, sourceActionId: secondAction.id, sourceAction: secondAction }),
    ] : []);

    const first = await loadDecisionInbox({ customerId: 'owner', clientProfileId: profile.id, websiteId: site.id });
    const second = await loadDecisionInbox({ customerId: 'owner', clientProfileId: secondProfile.id, websiteId: secondSite.id });
    expect(first.rows.map(row => row.id).sort()).toEqual(['first_action', 'first_content']);
    expect(second.rows.map(row => row.id).sort()).toEqual(['second_action', 'second_content']);
    expect(second.rows.find(row => row.id === 'second_content')).toMatchObject({
      href: null, unavailableReason: 'Direct client navigation in Content Studio is unavailable',
    });
    expect(first.rows.find(row => row.id === 'first_content')?.href).toBe('/studio?websiteId=site_1');
  });
  it('uses live wording for activation and collapses candidate/evaluation rows', async () => {
    mocks.preferenceCandidate.findMany.mockResolvedValue([candidate('proposed'), candidate('passed')]);
    mocks.preferenceEvaluation.findMany.mockResolvedValue([
      { id: 'eval_1', candidateId: 'passed', candidate: candidate('passed'), clientProfileId: 'cp_1', websiteId: 'site_1', clientProfile: profile, website: site, evaluatedPhrase: 'inactive', status: 'passed', activatedAt: date, startedAt: date },
      { id: 'eval_2', candidateId: 'active', candidate: candidate('active'), clientProfileId: 'cp_1', websiteId: 'site_1', clientProfile: profile, website: site, evaluatedPhrase: 'active', status: 'passed', activatedAt: null, startedAt: date },
    ]);
    const { rows } = await loadDecisionInbox({ customerId: 'owner' });
    expect(rows.filter(r => r.kind === 'preference').map(r => r.id).sort()).toEqual(['passed', 'proposed']);
    expect(rows.find(r => r.id === 'passed')?.scopeLabel).toContain('Whole client profile');
    expect(rows.find(r => r.id === 'passed')?.title).toContain('inactive');
  });
  it('includes unlinked content in client scope but not website scope', async () => {
    mocks.contentPiece.findMany.mockImplementation(async ({ where }) => where.status === 'needs_review' ? [piece('unlinked'), piece('linked', { sourceActionId: 'a', sourceAction: action('a') })] : [piece('failed_content', { status: 'failed' })]);
    const client = await loadDecisionInbox({ customerId: 'owner', clientProfileId: 'cp_1' });
    expect(client.rows).toContainEqual(expect.objectContaining({ kind: 'content', websiteId: null, scopeLabel: 'Client-wide; no website link' }));
    const website = await loadDecisionInbox({ customerId: 'owner', websiteId: 'site_1' });
    expect(website.rows.map(r => r.id)).toEqual(['linked']);
    expect(mocks.contentPiece.findMany.mock.calls.at(-1)?.[0].where).toMatchObject({ clientProfile: { customerId: 'owner' }, sourceAction: { customerId: 'owner', websiteId: 'site_1' } });
  });
  it('never exposes inconsistent ownership chains or cross-client content links', async () => {
    mocks.action.findMany.mockResolvedValue([action('foreign', { website: { ...site, clientProfile: { ...profile, customerId: 'foreign' } } })]);
    mocks.contentPiece.findMany.mockResolvedValue([piece('cross_client', { sourceActionId: 'a', sourceAction: action('a', { website: { ...site, clientProfileId: 'cp_2', clientProfile: { ...profile, id: 'cp_2' } } }) })]);
    const { rows } = await loadDecisionInbox({ customerId: 'owner' });
    expect(rows).toEqual([]);
  });
  // Phase 2E matrix (Ryan's 2026-10-04 note, Scout follow-up): "verify every required queue
  // lane, including a lane with no rows" -- a genuinely empty scope must resolve to a
  // well-formed empty result, never throw, and never be confused with the 404/not-found path
  // every other test above exercises (a missing scope is a thrown error, not an empty array).
  it('returns a well-formed empty result for a scope with no actions, content or preferences', async () => {
    const result = await loadDecisionInbox({ customerId: 'owner' });
    expect(result).toEqual({ rows: [], truncated: false, truncatedSections: [] });
  });

  it('uses a sentinel without exposing it or claiming total counts', async () => {
    mocks.action.findMany.mockImplementation(async ({ where }) => where.status === 'pending' ? Array.from({ length: 101 }, (_, n) => action(`a_${n}`)) : []);
    const result = await loadDecisionInbox({ customerId: 'owner' });
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(100);
    expect(result.rows.find(r => r.id === 'a_100')).toBeUndefined();
  });
});
