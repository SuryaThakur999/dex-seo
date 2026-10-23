import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { suggestionIdentity, validateSuggestionEvidence, type CrawledProfilePage } from './profile-suggestion-evidence';

interface SuggestionScope {
  customerId: string;
  clientProfileId: string;
  websiteId: string;
}

export class ProfileSuggestionError extends Error {
  constructor(public readonly code: 'not_found' | 'conflict' | 'invalid', message: string) {
    super(message);
    this.name = 'ProfileSuggestionError';
  }
}

async function requireWebsite(client: Prisma.TransactionClient, scope: SuggestionScope) {
  const website = await client.website.findFirst({
    where: { id: scope.websiteId, clientProfileId: scope.clientProfileId, clientProfile: { customerId: scope.customerId } },
    select: { id: true },
  });
  if (!website) throw new ProfileSuggestionError('not_found', 'Website not found');
}

// Memory refresh (social-profile-discovery plan, 2026-10-17): read-time only, no new column.
// The re-propose-on-change mechanism (identity hash + skipDuplicates in storeProfileSuggestions)
// already fires for every field today; this just labels a re-suggested field as an update
// instead of new information, by checking whether this clientProfile already has an accepted
// row for the same field.
export async function listProfileSuggestions(scope: SuggestionScope) {
  await requireWebsite(db, scope);
  const [suggested, acceptedRows] = await Promise.all([
    db.profileSuggestion.findMany({
      where: { websiteId: scope.websiteId, clientProfileId: scope.clientProfileId, status: 'suggested' },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }),
    db.profileSuggestion.findMany({
      where: { clientProfileId: scope.clientProfileId, status: 'accepted' },
      select: { field: true },
    }),
  ]);
  const acceptedFields = new Set(acceptedRows.map((r) => r.field));
  return suggested.map((row) => ({ ...row, isUpdate: acceptedFields.has(row.field) }));
}

export async function storeProfileSuggestions(
  scope: SuggestionScope,
  proposals: readonly unknown[],
  pages: readonly CrawledProfilePage[],
  versions: { modelVersion: string; promptVersion: string },
) {
  await requireWebsite(db, scope);
  const data = proposals.map((input) => {
    const proposal = validateSuggestionEvidence(input, pages);
    return {
      websiteId: scope.websiteId, clientProfileId: scope.clientProfileId,
      field: proposal.field, valueJson: proposal.value as Prisma.InputJsonValue,
      sourceUrl: proposal.sourceUrl, sourceExcerpt: proposal.sourceExcerpt,
      identity: suggestionIdentity({ ...scope, ...proposal }), ...versions,
    };
  });
  if (!data.length) return { count: 0 };
  return db.profileSuggestion.createMany({ data, skipDuplicates: true });
}

export async function decideProfileSuggestion(
  scope: SuggestionScope,
  suggestionId: string,
  decision: { action: 'accept' | 'reject'; value?: unknown },
) {
  if (decision.action !== 'accept' && decision.action !== 'reject') throw new ProfileSuggestionError('invalid', 'Invalid suggestion decision');
  return db.$transaction(async (tx) => {
    await requireWebsite(tx, scope);
    const where = {
      id: suggestionId, websiteId: scope.websiteId, clientProfileId: scope.clientProfileId,
      status: 'suggested' as const,
    };
    const suggestion = await tx.profileSuggestion.findFirst({ where });
    if (!suggestion) throw new ProfileSuggestionError('not_found', 'Suggestion not found');
    let chosen = null;
    try {
      chosen = decision.action === 'accept' ? validateSuggestionEvidence({
      field: suggestion.field,
      value: decision.value === undefined ? suggestion.valueJson : decision.value,
      sourceUrl: suggestion.sourceUrl, sourceExcerpt: suggestion.sourceExcerpt,
      }, [{ url: suggestion.sourceUrl, text: suggestion.sourceExcerpt }]) : null;
    } catch {
      throw new ProfileSuggestionError('invalid', 'Invalid suggestion value');
    }
    // Claim the pending decision before changing memory; a competing decision must not write it again.
    const result = await tx.profileSuggestion.updateMany({
      where, data: { status: decision.action === 'accept' ? 'accepted' : 'rejected', decidedAt: new Date() },
    });
    if (result.count !== 1) throw new ProfileSuggestionError('conflict', 'Suggestion already decided');
    if (chosen) {
      await tx.clientProfile.update({ where: { id: scope.clientProfileId }, data: { [chosen.field]: chosen.value } });
    }
    return { status: decision.action === 'accept' ? 'accepted' : 'rejected' };
  });
}
