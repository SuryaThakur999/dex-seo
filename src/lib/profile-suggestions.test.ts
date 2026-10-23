import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { decideProfileSuggestion, listProfileSuggestions, storeProfileSuggestions } from './profile-suggestions';

vi.mock('@/lib/db', () => ({ db: {
  website: { findFirst: vi.fn() },
  profileSuggestion: { findMany: vi.fn(), findFirst: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  clientProfile: { update: vi.fn() },
  $transaction: vi.fn(),
} }));

const scope = { customerId: 'customer-1', clientProfileId: 'profile-1', websiteId: 'website-1' };
const proposal = { field: 'audience', value: 'Local shops', sourceUrl: 'https://shop.test/about', sourceExcerpt: 'We serve local shops.' };
const pages = [{ url: proposal.sourceUrl, text: proposal.sourceExcerpt }];
const row = { id: 'suggestion-1', field: 'audience', valueJson: 'Local shops', sourceUrl: proposal.sourceUrl, sourceExcerpt: proposal.sourceExcerpt };

describe('profile suggestions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.website.findFirst).mockResolvedValue({ id: scope.websiteId } as never);
    vi.mocked(db.profileSuggestion.findFirst).mockResolvedValue(row as never);
    vi.mocked(db.profileSuggestion.findMany).mockResolvedValue([]);
    vi.mocked(db.profileSuggestion.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.$transaction).mockImplementation(async (work: unknown) =>
      (work as (tx: typeof db) => Promise<unknown>)(db) as never);
  });

  it('requires the exact site, profile and customer for reads', async () => {
    await listProfileSuggestions(scope);
    expect(db.website.findFirst).toHaveBeenCalledWith({ where: {
      id: scope.websiteId, clientProfileId: scope.clientProfileId,
      clientProfile: { customerId: scope.customerId },
    }, select: { id: true } });
    expect(db.profileSuggestion.findMany).toHaveBeenCalledWith({
      where: { websiteId: scope.websiteId, clientProfileId: scope.clientProfileId, status: 'suggested' },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  });

  it.each(['other customer', 'same customer, different profile'])('rejects %s before reading or deciding', async () => {
    vi.mocked(db.website.findFirst).mockResolvedValue(null);
    await expect(listProfileSuggestions(scope)).rejects.toThrow('Website not found');
    await expect(decideProfileSuggestion(scope, row.id, { action: 'accept' })).rejects.toThrow('Website not found');
    expect(db.profileSuggestion.findMany).not.toHaveBeenCalled();
    expect(db.profileSuggestion.findFirst).not.toHaveBeenCalled();
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('stores validated evidence without updating profile values or existing decisions', async () => {
    await storeProfileSuggestions(scope, [proposal], pages, { modelVersion: 'model-1', promptVersion: 'prompt-1' });
    expect(db.profileSuggestion.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      websiteId: scope.websiteId, clientProfileId: scope.clientProfileId, field: 'audience',
      valueJson: 'Local shops', sourceUrl: proposal.sourceUrl, sourceExcerpt: proposal.sourceExcerpt,
      identity: expect.any(String), modelVersion: 'model-1', promptVersion: 'prompt-1',
    })], skipDuplicates: true });
    expect(db.clientProfile.update).not.toHaveBeenCalled();
    expect(db.profileSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it('uses the same identity after model changes so rejected suggestions stay suppressed', async () => {
    await storeProfileSuggestions(scope, [proposal], pages, { modelVersion: 'v1', promptVersion: 'v1' });
    await storeProfileSuggestions(scope, [proposal], pages, { modelVersion: 'v2', promptVersion: 'v2' });
    const calls = vi.mocked(db.profileSuggestion.createMany).mock.calls;
    expect(calls[0][0]?.data).toEqual([expect.objectContaining({ identity: (calls[1][0]?.data as { identity: string }[])[0].identity })]);
  });

  it('rejects unsupported fields and missing evidence before storing anything', async () => {
    await expect(storeProfileSuggestions(scope, [{ ...proposal, field: 'approvedClaims' }], pages, { modelVersion: 'v1', promptVersion: 'v1' })).rejects.toThrow();
    await expect(storeProfileSuggestions(scope, [proposal], [], { modelVersion: 'v1', promptVersion: 'v1' })).rejects.toThrow();
    expect(db.profileSuggestion.createMany).not.toHaveBeenCalled();
  });

  it('rejects without touching manual profile values', async () => {
    await decideProfileSuggestion(scope, row.id, { action: 'reject' });
    expect(db.profileSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, websiteId: scope.websiteId, clientProfileId: scope.clientProfileId, status: 'suggested' },
      data: { status: 'rejected', decidedAt: expect.any(Date) },
    });
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('accepts only the selected field in the same transaction as its decision', async () => {
    await decideProfileSuggestion(scope, row.id, { action: 'accept' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.clientProfile.update).toHaveBeenCalledWith({ where: { id: scope.clientProfileId }, data: { audience: 'Local shops' } });
    expect(db.profileSuggestion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'accepted', decidedAt: expect.any(Date) } }));
  });

  it('validates edited values and writes only the edited field', async () => {
    await expect(decideProfileSuggestion(scope, row.id, { action: 'accept', value: ['wrong type'] })).rejects.toThrow();
    expect(db.profileSuggestion.updateMany).not.toHaveBeenCalled();
    await decideProfileSuggestion(scope, row.id, { action: 'accept', value: 'Independent retailers' });
    expect(db.clientProfile.update).toHaveBeenCalledWith({ where: { id: scope.clientProfileId }, data: { audience: 'Independent retailers' } });
  });

  it('does not mutate a profile when another request already decided the suggestion', async () => {
    vi.mocked(db.profileSuggestion.updateMany).mockResolvedValue({ count: 0 });
    await expect(decideProfileSuggestion(scope, row.id, { action: 'accept' })).rejects.toThrow('Suggestion already decided');
    expect(db.clientProfile.update).not.toHaveBeenCalled();
  });

  it('does not decide a suggestion outside the exact site and profile', async () => {
    vi.mocked(db.profileSuggestion.findFirst).mockResolvedValue(null);
    await expect(decideProfileSuggestion(scope, row.id, { action: 'accept' })).rejects.toThrow('Suggestion not found');
    expect(db.profileSuggestion.findFirst).toHaveBeenCalledWith({ where: {
      id: row.id, websiteId: scope.websiteId, clientProfileId: scope.clientProfileId, status: 'suggested',
    } });
    expect(db.profileSuggestion.updateMany).not.toHaveBeenCalled();
  });
});

describe('memory refresh -- isUpdate labeling (social-profile-discovery plan, 2026-10-17)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.website.findFirst).mockResolvedValue({ id: scope.websiteId } as never);
  });

  it('marks a suggested row isUpdate: true when an accepted row already exists for the same field', async () => {
    vi.mocked(db.profileSuggestion.findMany)
      .mockResolvedValueOnce([row] as never) // suggested rows
      .mockResolvedValueOnce([{ field: 'audience' }] as never); // accepted fields

    const result = await listProfileSuggestions(scope);

    expect(result[0]).toMatchObject({ id: row.id, isUpdate: true });
  });

  it('marks isUpdate: false for a field with no prior accepted row', async () => {
    vi.mocked(db.profileSuggestion.findMany)
      .mockResolvedValueOnce([row] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProfileSuggestions(scope);

    expect(result[0]).toMatchObject({ id: row.id, isUpdate: false });
  });
});
