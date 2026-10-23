import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getMarketingMemory } from './marketing-memory';

vi.mock('@/lib/db', () => ({
  db: {
    clientProfile: { findUniqueOrThrow: vi.fn() },
    preferenceEvaluation: { findMany: vi.fn() },
  },
}));

const emptyProfile = {
  businessDescription: null, audience: null, brandVoice: null,
  markets: [], languages: [], approvedClaims: [], restrictedWording: [],
};

describe('getMarketingMemory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (db.clientProfile.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(emptyProfile);
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('marks unmatched restricted wording as a profile value without evaluator metadata', async () => {
    (db.clientProfile.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ ...emptyProfile, restrictedWording: ['guaranteed results'] });
    const result = await getMarketingMemory('cp_1');
    expect(result).toEqual({ clientProfileId: 'cp_1', facts: [{
      field: 'restrictedWording', value: 'guaranteed results', source: 'client_profile',
      evaluatorVersion: null, scope: 'client_profile', decidedAt: null,
    }] });
  });

  it('marks an active evaluation match with its version, activation time and profile scope', async () => {
    (db.clientProfile.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ ...emptyProfile, restrictedWording: ['100% organic'] });
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { evaluatedPhrase: '100% organic', evaluatorVersion: 'v2', activatedAt: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    const result = await getMarketingMemory('cp_1');
    expect(result.facts).toEqual([{
      field: 'restrictedWording', value: '100% organic', source: 'activated_preference_match',
      evaluatorVersion: 'v2', scope: 'client_profile', decidedAt: '2026-09-01T00:00:00.000Z',
    }]);
  });

  it('uses the newest matching evaluation when phrases are duplicated', async () => {
    (db.clientProfile.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ ...emptyProfile, restrictedWording: ['guaranteed results'] });
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { evaluatedPhrase: 'guaranteed results', evaluatorVersion: 'v2', activatedAt: new Date('2026-09-01T00:00:00.000Z') },
      { evaluatedPhrase: 'guaranteed results', evaluatorVersion: 'v1', activatedAt: new Date('2026-08-01T00:00:00.000Z') },
    ]);
    const result = await getMarketingMemory('cp_1');
    expect(result.facts).toEqual([{
      field: 'restrictedWording', value: 'guaranteed results', source: 'activated_preference_match',
      evaluatorVersion: 'v2', scope: 'client_profile', decidedAt: '2026-09-01T00:00:00.000Z',
    }]);
  });

  it('includes populated scalar and array fields while omitting empty values', async () => {
    (db.clientProfile.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...emptyProfile, businessDescription: 'DACH SMB SEO tool', brandVoice: 'direct, calm',
      markets: ['DE', 'AT'], languages: ['de'], approvedClaims: ['Founded in 2020'],
    });
    const result = await getMarketingMemory('cp_1');
    expect(result.facts).toEqual([
      { field: 'businessDescription', value: 'DACH SMB SEO tool', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'brandVoice', value: 'direct, calm', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'markets', value: 'DE', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'markets', value: 'AT', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'languages', value: 'de', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'approvedClaims', value: 'Founded in 2020', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
    ]);
  });

  it('queries only this profile and active restricted-wording evaluations with stable ordering', async () => {
    expect(await getMarketingMemory('cp_1')).toEqual({ clientProfileId: 'cp_1', facts: [] });
    expect(db.clientProfile.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'cp_1' }, select: {
        businessDescription: true, audience: true, brandVoice: true,
        markets: true, languages: true, approvedClaims: true, restrictedWording: true,
      },
    });
    expect(db.preferenceEvaluation.findMany).toHaveBeenCalledWith({
      where: { clientProfileId: 'cp_1', targetField: 'restrictedWording', activatedAt: { not: null }, deactivatedAt: null },
      orderBy: [{ activatedAt: 'desc' }, { id: 'desc' }],
      select: { evaluatedPhrase: true, evaluatorVersion: true, activatedAt: true },
    });
  });

  it('does not restore a phrase removed from the live profile array', async () => {
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { evaluatedPhrase: 'guaranteed results', evaluatorVersion: 'v2', activatedAt: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    expect(await getMarketingMemory('cp_1')).toEqual({ clientProfileId: 'cp_1', facts: [] });
  });

  it('preserves exact phrase matching without normalizing profile text', async () => {
    (db.clientProfile.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ ...emptyProfile, audience: 'Local businesses', restrictedWording: ['Organic'] });
    (db.preferenceEvaluation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { evaluatedPhrase: 'organic', evaluatorVersion: 'v2', activatedAt: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    const result = await getMarketingMemory('cp_1');
    expect(result.facts).toEqual([
      { field: 'audience', value: 'Local businesses', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'restrictedWording', value: 'Organic', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
    ]);
  });

  it('propagates a missing profile without querying evaluations', async () => {
    const error = new Error('Profile not found');
    (db.clientProfile.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockRejectedValue(error);
    await expect(getMarketingMemory('missing')).rejects.toBe(error);
    expect(db.preferenceEvaluation.findMany).not.toHaveBeenCalled();
  });
});
