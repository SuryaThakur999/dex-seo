import { db } from './db';
import { normalizeSiteUrl } from './entitlements';
import type { Customer, Website } from '@prisma/client';

export const PENDING_WEBSITE_URL = 'https://example-pending-setup.com';

/**
 * Ensures a Customer (workspace) exists for this Clerk user, with its
 * implicit owner membership and default client profile + website. Returns
 * the default website too since almost every caller needs "the site"
 * immediately — this is the single-site path; multi-site/multi-profile
 * workspaces select explicitly instead of calling this.
 */
export async function ensureCustomer(
  clerkUserId: string,
  websiteUrl: string
): Promise<{ customer: Customer; website: Website }> {
  const customer = await db.customer.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      members: { create: { clerkUserId, role: 'owner' } },
      clientProfiles: {
        create: {
          name: 'Default',
          isDefault: true,
          websites: { create: { url: websiteUrl, normalizedHost: normalizeSiteUrl(websiteUrl) } },
        },
      },
    },
    include: { clientProfiles: { where: { isDefault: true }, include: { websites: true } } },
  });

  const website = customer.clientProfiles[0]?.websites[0];
  if (!website) {
    // Existing customer whose default profile/website is somehow missing
    // (shouldn't happen post-migration, but don't leave the caller stuck).
    throw new Error(`Customer ${customer.id} has no default website`);
  }

  return { customer, website };
}

export class WebsiteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebsiteNotFoundError';
  }
}

/**
 * Resolves a website within an owned client profile. Without a profile ID,
 * retains the default-profile behavior. Without a website ID, selects the
 * first-created website in that profile.
 */
export async function resolveWebsiteForRequest(
  clerkUserId: string,
  websiteId?: string,
  clientProfileId?: string
): Promise<{ customer: Customer; website: Website; websites: Website[] }> {
  const { customer, website: defaultWebsite } = await ensureCustomer(clerkUserId, PENDING_WEBSITE_URL);

  // A websiteId can belong to ANY of this customer's client profiles, not just the
  // default one -- a customer running more than one company (brand-voice-isolation
  // fix, 2026-10-16) picks a specific site across any of them. Resolve its real
  // owning profile first instead of assuming default, then treat it exactly like an
  // explicit clientProfileId from here on. Scoped to this customer's own profiles,
  // so a foreign website id resolves to nothing rather than leaking ownership.
  if (websiteId && !clientProfileId) {
    const owned = await db.website.findFirst({
      where: { id: websiteId, clientProfile: { customerId: customer.id } },
      select: { clientProfileId: true },
    });
    if (!owned) throw new WebsiteNotFoundError(`Website ${websiteId} not found on this workspace.`);
    clientProfileId = owned.clientProfileId;
  }

  const profile = await db.clientProfile.findFirst({
    where: { customerId: customer.id, ...(clientProfileId ? { id: clientProfileId } : { isDefault: true }) },
    include: { websites: { orderBy: { createdAt: 'asc' } } },
  });
  if (clientProfileId && !profile?.websites.length) {
    throw new WebsiteNotFoundError('Client profile has no accessible website.');
  }

  // The default must come from this ordered array, not ensureCustomer's own
  // unordered `websites` include — without an orderBy, Postgres is free to
  // return rows in any order, so once a workspace has two sites the fallback
  // would drift between requests and point writes at the wrong website.
  // (`?? defaultWebsite` only covers the impossible-in-practice empty-array
  // case, so the fallback is never the non-deterministic row.)
  const profileWebsites = profile?.websites ?? [defaultWebsite];

  // Every site switcher across the app lists every website this customer owns,
  // across every company, not just the one currently selected -- that's what lets
  // switching between companies happen from the same dropdown.
  const allWebsites = await db.website.findMany({
    where: { clientProfile: { customerId: customer.id } },
    orderBy: { createdAt: 'asc' },
  });
  const websites = allWebsites.length ? allWebsites : profileWebsites;

  if (!websiteId) return { customer, website: profileWebsites[0] ?? defaultWebsite, websites };

  const website = profileWebsites.find((w) => w.id === websiteId);
  if (!website) {
    throw new WebsiteNotFoundError(`Website ${websiteId} not found on this workspace.`);
  }
  return { customer, website, websites };
}
