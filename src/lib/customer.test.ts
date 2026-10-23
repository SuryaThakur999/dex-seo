import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureCustomer } from './customer';
import { db } from './db';

vi.mock('./db', () => ({
  db: {
    customer: {
      upsert: vi.fn(),
    },
    clientProfile: {
      findFirst: vi.fn(),
    },
    website: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('ensureCustomer', () => {
  it('upserts on clerkUserId and returns the customer with its default website', async () => {
    const customer = {
      id: 'c1',
      clerkUserId: 'user_1',
      clientProfiles: [{ websites: [{ id: 'w1', url: 'https://a.com', normalizedHost: 'a.com' }] }],
    };
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(customer);

    const result = await ensureCustomer('user_1', 'https://a.com');

    expect(result.customer).toBe(customer);
    expect(result.website).toEqual({ id: 'w1', url: 'https://a.com', normalizedHost: 'a.com' });
    expect(db.customer.upsert).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_1' },
      update: {},
      create: {
        clerkUserId: 'user_1',
        members: { create: { clerkUserId: 'user_1', role: 'owner' } },
        clientProfiles: {
          create: {
            name: 'Default',
            isDefault: true,
            websites: { create: { url: 'https://a.com', normalizedHost: 'a.com' } },
          },
        },
      },
      include: { clientProfiles: { where: { isDefault: true }, include: { websites: true } } },
    });
  });

  it('throws if the default website is missing (defensive, should not happen post-migration)', async () => {
    const customer = { id: 'c1', clerkUserId: 'user_1', clientProfiles: [] };
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(customer);

    await expect(ensureCustomer('user_1', 'https://a.com')).rejects.toThrow('has no default website');
  });
});

import { resolveWebsiteForRequest, WebsiteNotFoundError } from './customer';

describe('resolveWebsiteForRequest', () => {
  const upsertedCustomer = {
    id: 'c1',
    clerkUserId: 'user_1',
    clientProfiles: [{ websites: [{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }] }],
  };

  beforeEach(() => {
    // Every call now also checks (a) which profile actually owns a given websiteId and
    // (b) every website across every one of the customer's profiles, for the cross-
    // company site switcher (2026-10-16 brand-voice-isolation fix). Safe no-op defaults;
    // individual tests override when they care about these two calls specifically.
    vi.mocked(db.website.findFirst).mockResolvedValue(null);
    vi.mocked(db.website.findMany).mockResolvedValue([]);
  });

  it('returns the first website and full sibling list when no websiteId is given', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      websites: [{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }],
    });

    const result = await resolveWebsiteForRequest('user_1');

    expect(result.website).toEqual({ id: 'w1', url: 'https://a.com' });
    expect(result.websites).toEqual([{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }]);
  });

  it('defaults to the oldest website from the ordered query, not whatever ensureCustomer returned first', async () => {
    // ensureCustomer's own `websites` include has no orderBy, so Postgres may
    // hand back w2 first; the ordered clientProfile query is the source of truth.
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'c1',
      clerkUserId: 'user_1',
      clientProfiles: [{ websites: [{ id: 'w2', url: 'https://b.com' }, { id: 'w1', url: 'https://a.com' }] }],
    });
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      websites: [{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }],
    });

    const result = await resolveWebsiteForRequest('user_1');

    expect(result.website).toEqual({ id: 'w1', url: 'https://a.com' });
  });

  it('returns the matching website when a valid websiteId is given', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      websites: [{ id: 'w1', url: 'https://a.com' }, { id: 'w2', url: 'https://b.com' }],
    });
    vi.mocked(db.website.findFirst).mockResolvedValue({ clientProfileId: 'cp_default' } as never);

    const result = await resolveWebsiteForRequest('user_1', 'w2');

    expect(result.website).toEqual({ id: 'w2', url: 'https://b.com' });
  });

  it('throws WebsiteNotFoundError for a websiteId that does not belong to this customer', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    // Ownership lookup (scoped to this customer) finds nothing -- the real tenant-
    // isolation check, not just an empty sibling list in the default profile.
    vi.mocked(db.website.findFirst).mockResolvedValue(null);

    await expect(resolveWebsiteForRequest('user_1', 'someone-elses-website')).rejects.toThrow(WebsiteNotFoundError);
  });

  it('resolves a websiteId owned by a NON-default client profile instead of assuming default', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    vi.mocked(db.website.findFirst).mockResolvedValue({ clientProfileId: 'cp_second' } as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue({
      websites: [{ id: 'site_second', url: 'https://b.test', clientProfileId: 'cp_second' }],
    } as never);

    const result = await resolveWebsiteForRequest('user_1', 'site_second');

    expect(db.clientProfile.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'c1', id: 'cp_second' },
      include: { websites: { orderBy: { createdAt: 'asc' } } },
    });
    expect(result.website).toEqual({ id: 'site_second', url: 'https://b.test', clientProfileId: 'cp_second' });
  });

  it('lists every website across every one of the customer\'s client profiles, not just the resolved one', async () => {
    (db.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(upsertedCustomer);
    (db.clientProfile.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      websites: [{ id: 'w1', url: 'https://a.com' }],
    });
    const everyWebsite = [{ id: 'w1', url: 'https://a.com' }, { id: 'site_second', url: 'https://b.test' }];
    vi.mocked(db.website.findMany).mockResolvedValue(everyWebsite as never);

    const result = await resolveWebsiteForRequest('user_1');

    expect(db.website.findMany).toHaveBeenCalledWith({
      where: { clientProfile: { customerId: 'c1' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(result.websites).toEqual(everyWebsite);
  });

  it('resolves the oldest website within an explicitly selected owned profile', async () => {
    vi.mocked(db.customer.upsert).mockResolvedValue(upsertedCustomer as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue({
      websites: [{ id: 'client-site', url: 'https://client.test' }],
    } as never);

    const result = await resolveWebsiteForRequest('user_1', undefined, 'client-profile');

    expect(db.clientProfile.findFirst).toHaveBeenLastCalledWith({
      where: { customerId: 'c1', id: 'client-profile' },
      include: { websites: { orderBy: { createdAt: 'asc' } } },
    });
    expect(result.website.id).toBe('client-site');
  });

  it('rejects a missing or foreign explicit profile without falling back to the default site', async () => {
    vi.mocked(db.customer.upsert).mockResolvedValue(upsertedCustomer as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue(null);

    await expect(resolveWebsiteForRequest('user_1', undefined, 'foreign-profile'))
      .rejects.toThrow(WebsiteNotFoundError);
  });

  it('rejects an explicit profile with no websites without falling back', async () => {
    vi.mocked(db.customer.upsert).mockResolvedValue(upsertedCustomer as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue({ websites: [] } as never);

    await expect(resolveWebsiteForRequest('user_1', undefined, 'empty-profile'))
      .rejects.toThrow(WebsiteNotFoundError);
  });

  it('rejects a sibling profile website even when both profiles share the customer', async () => {
    vi.mocked(db.customer.upsert).mockResolvedValue(upsertedCustomer as never);
    vi.mocked(db.clientProfile.findFirst).mockResolvedValue({
      websites: [{ id: 'client-site', url: 'https://client.test' }],
    } as never);

    await expect(resolveWebsiteForRequest('user_1', 'w1', 'client-profile'))
      .rejects.toThrow(WebsiteNotFoundError);
  });
});
