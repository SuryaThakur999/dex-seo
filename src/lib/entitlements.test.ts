import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  normalizeSiteUrl,
  createWebsiteWithEntitlementCheck,
  createClientProfileWithEntitlementCheck,
  EntitlementLimitError,
  DuplicateWebsiteError,
} from './entitlements';
import { db } from './db';

vi.mock('./db', () => ({
  db: { $transaction: vi.fn() },
}));

describe('normalizeSiteUrl', () => {
  it('strips scheme and www, lowercases the host', () => {
    expect(normalizeSiteUrl('https://WWW.Example.com/path?x=1')).toBe('example.com');
    expect(normalizeSiteUrl('http://example.com')).toBe('example.com');
  });

  it('treats different paths of the same host as the same identity', () => {
    expect(normalizeSiteUrl('https://example.com/a')).toBe(normalizeSiteUrl('https://example.com/b'));
  });

  it('falls back to string parsing for a non-URL input instead of throwing', () => {
    expect(normalizeSiteUrl('not-a-real-url')).toBe('not-a-real-url');
  });
});

function mockTx(overrides: Record<string, unknown> = {}) {
  return {
    clientProfile: { findUniqueOrThrow: vi.fn(), count: vi.fn(), create: vi.fn() },
    website: { count: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    customer: { findUniqueOrThrow: vi.fn() },
    ...overrides,
  };
}

describe('createWebsiteWithEntitlementCheck', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates the website when under the limit and not a duplicate', async () => {
    const tx = mockTx();
    tx.clientProfile.findUniqueOrThrow.mockResolvedValue({ id: 'cp_1', maxWebsites: 3 });
    tx.website.count.mockResolvedValue(1);
    tx.website.findUnique.mockResolvedValue(null);
    tx.website.create.mockResolvedValue({ id: 'web_new', url: 'https://b.com', normalizedHost: 'b.com' });
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    const result = await createWebsiteWithEntitlementCheck({ clientProfileId: 'cp_1', url: 'https://b.com' });

    expect(result).toEqual({ id: 'web_new', url: 'https://b.com', normalizedHost: 'b.com' });
    expect(tx.website.create).toHaveBeenCalledWith({
      data: { clientProfileId: 'cp_1', url: 'https://b.com', normalizedHost: 'b.com' },
    });
  });

  it('rejects with EntitlementLimitError when the profile is already at maxWebsites', async () => {
    const tx = mockTx();
    tx.clientProfile.findUniqueOrThrow.mockResolvedValue({ id: 'cp_1', maxWebsites: 3 });
    tx.website.count.mockResolvedValue(3);
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await expect(createWebsiteWithEntitlementCheck({ clientProfileId: 'cp_1', url: 'https://d.com' })).rejects.toThrow(
      EntitlementLimitError
    );
    expect(tx.website.create).not.toHaveBeenCalled();
  });

  it('rejects with DuplicateWebsiteError for a site already registered on the profile, even via a different path', async () => {
    const tx = mockTx();
    tx.clientProfile.findUniqueOrThrow.mockResolvedValue({ id: 'cp_1', maxWebsites: 3 });
    tx.website.count.mockResolvedValue(1);
    tx.website.findUnique.mockResolvedValue({ id: 'existing', normalizedHost: 'b.com' });
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await expect(
      createWebsiteWithEntitlementCheck({ clientProfileId: 'cp_1', url: 'https://b.com/some/other/path' })
    ).rejects.toThrow(DuplicateWebsiteError);
    expect(tx.website.create).not.toHaveBeenCalled();
  });

  it('converts a serializable-conflict error (concurrent request) into EntitlementLimitError rather than a raw Prisma error', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('could not serialize', {
      code: 'P2034',
      clientVersion: '5.22.0',
    });
    (db.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(conflict);

    await expect(createWebsiteWithEntitlementCheck({ clientProfileId: 'cp_1', url: 'https://b.com' })).rejects.toThrow(
      EntitlementLimitError
    );
  });
});

describe('createClientProfileWithEntitlementCheck', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates the profile when under the workspace limit', async () => {
    const tx = mockTx();
    tx.customer.findUniqueOrThrow.mockResolvedValue({ id: 'cust_1', maxClientProfiles: 2 });
    tx.clientProfile.count.mockResolvedValue(1);
    tx.clientProfile.create.mockResolvedValue({ id: 'cp_new', name: 'Acme' });
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    const result = await createClientProfileWithEntitlementCheck({ customerId: 'cust_1', name: 'Acme' });

    expect(result).toEqual({ id: 'cp_new', name: 'Acme' });
  });

  it('rejects with EntitlementLimitError when the workspace is already at maxClientProfiles', async () => {
    const tx = mockTx();
    tx.customer.findUniqueOrThrow.mockResolvedValue({ id: 'cust_1', maxClientProfiles: 1 });
    tx.clientProfile.count.mockResolvedValue(1);
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await expect(createClientProfileWithEntitlementCheck({ customerId: 'cust_1', name: 'Acme' })).rejects.toThrow(
      EntitlementLimitError
    );
    expect(tx.clientProfile.create).not.toHaveBeenCalled();
  });
});
