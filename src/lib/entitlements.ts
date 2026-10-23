import { db } from './db';
import { Prisma } from '@prisma/client';

/**
 * Host-only identity key for a website: lowercased, no scheme, no "www.",
 * no path/query/hash. Two URLs that only differ by path or protocol must
 * normalize to the same value so they never count as separate websites.
 */
export function normalizeSiteUrl(rawUrl: string): string {
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    host = rawUrl.replace(/^https?:\/\//, '').split('/')[0];
  }
  return host.toLowerCase().replace(/^www\./, '');
}

export class EntitlementLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntitlementLimitError';
  }
}

export class DuplicateWebsiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateWebsiteError';
  }
}

/**
 * Creates a Website under a client profile, enforcing maxWebsites atomically.
 * Serializable isolation makes concurrent requests against the same profile
 * conflict rather than both slipping past a stale count — one wins, the
 * other gets a clean EntitlementLimitError-shaped rejection to retry as a
 * denial, not a silent overshoot.
 */
export async function createWebsiteWithEntitlementCheck(params: {
  clientProfileId: string;
  url: string;
}) {
  const normalizedHost = normalizeSiteUrl(params.url);

  try {
    return await db.$transaction(
      async (tx) => {
        const profile = await tx.clientProfile.findUniqueOrThrow({
          where: { id: params.clientProfileId },
        });

        const activeCount = await tx.website.count({
          where: { clientProfileId: params.clientProfileId, status: 'active' },
        });

        if (activeCount >= profile.maxWebsites) {
          throw new EntitlementLimitError(
            `This client profile already has ${activeCount} of ${profile.maxWebsites} allowed websites.`
          );
        }

        const existing = await tx.website.findUnique({
          where: { clientProfileId_normalizedHost: { clientProfileId: params.clientProfileId, normalizedHost } },
        });
        if (existing) {
          throw new DuplicateWebsiteError(`${normalizedHost} is already registered on this client profile.`);
        }

        return tx.website.create({
          data: { clientProfileId: params.clientProfileId, url: params.url, normalizedHost },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof EntitlementLimitError || err instanceof DuplicateWebsiteError) throw err;
    // A serializable conflict from a concurrent identical request lands here
    // (Postgres error code 40001) — treat it the same as a limit hit rather
    // than surfacing a raw transaction error to the caller.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      throw new EntitlementLimitError('Another request just changed this client profile — please retry.');
    }
    throw err;
  }
}

/** Same atomicity pattern for the workspace-level client-profile limit. */
export async function createClientProfileWithEntitlementCheck(params: {
  customerId: string;
  name: string;
}) {
  try {
    return await db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: params.customerId } });
        const count = await tx.clientProfile.count({ where: { customerId: params.customerId } });

        if (count >= customer.maxClientProfiles) {
          throw new EntitlementLimitError(
            `This workspace already has ${count} of ${customer.maxClientProfiles} allowed client profiles.`
          );
        }

        return tx.clientProfile.create({
          data: { customerId: params.customerId, name: params.name },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof EntitlementLimitError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      throw new EntitlementLimitError('Another request just changed this workspace — please retry.');
    }
    throw err;
  }
}
