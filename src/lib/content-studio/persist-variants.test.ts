import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  ContentVariantRetryConflictError,
  createContentPieceWithVariants,
  retryContentVariant,
  retryLegacyContentPiece,
  type VariantGenerationResult,
} from './persist-variants';

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    contentPiece: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    contentVariant: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

const mockedDb = db as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  contentPiece: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
  contentVariant: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

function variant(index: number, overrides: Partial<VariantGenerationResult> = {}): VariantGenerationResult {
  return {
    index,
    angle: `angle-${index}`,
    draftContent: { body: `draft-${index}` },
    status: 'needs_review',
    failureReason: null,
    critique: null,
    tokenCost: 100 + index,
    proofChecks: [{ check: 'disclosure', outcome: 'pass' }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.$transaction.mockImplementation((callback: (tx: typeof mockedDb) => unknown) => callback(mockedDb));
});

describe('createContentPieceWithVariants', () => {
  it('creates the parent and all three ordered variants in one transaction', async () => {
    mockedDb.contentPiece.create.mockResolvedValue({ id: 'piece_1', tokenCost: 303 });
    mockedDb.contentVariant.create.mockImplementation(({ data }) => Promise.resolve({ id: `variant_${data.index}`, ...data }));

    const result = await createContentPieceWithVariants(
      {
        clientProfileId: 'profile_1',
        websiteId: 'site_1',
        platform: 'linkedin',
        topic: 'A useful topic',
        draftContent: { body: 'draft-0' },
      },
      [variant(0), variant(1), variant(2)],
    );

    expect(mockedDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedDb.contentPiece.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tokenCost: 303 }),
    });
    expect(mockedDb.contentVariant.create).toHaveBeenCalledTimes(3);
    expect(mockedDb.contentVariant.create.mock.calls.map(([call]) => call.data.index)).toEqual([0, 1, 2]);
    expect(result.variants).toHaveLength(3);
  });

  it('rejects missing or unstable indexes before starting a transaction', async () => {
    await expect(createContentPieceWithVariants({} as never, [variant(0), variant(2), variant(1)])).rejects.toThrow(
      /stable indexes 0, 1, and 2/,
    );
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });
});

describe('retryContentVariant', () => {
  const replacement = {
    angle: 'angle-1',
    draftContent: { body: 'replacement' },
    status: 'needs_review' as const,
    failureReason: null,
    critique: null,
    tokenCost: 60,
    proofChecks: [{ check: 'disclosure', outcome: 'pass' }],
  };

  it('updates only the selected failed variant and increments aggregate usage', async () => {
    mockedDb.contentVariant.findUnique.mockResolvedValue({ id: 'variant_1', index: 1, status: 'failed', tokenCost: 100 });
    mockedDb.contentVariant.updateMany.mockResolvedValue({ count: 1 });
    mockedDb.contentVariant.findUniqueOrThrow.mockResolvedValue({ id: 'variant_1', index: 1, tokenCost: 160 });

    const result = await retryContentVariant('piece_1', 1, replacement);

    expect(mockedDb.contentVariant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contentPieceId: 'piece_1', index: 1, status: 'failed', tokenCost: 100 },
      data: expect.objectContaining({ tokenCost: { increment: 60 } }),
    }));
    expect(mockedDb.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: { tokenCost: { increment: 60 } },
    });
    expect(result.tokenCost).toBe(160);
  });

  it('keeps the representative parent fields aligned when index zero is retried', async () => {
    mockedDb.contentVariant.findUnique.mockResolvedValue({ id: 'variant_0', index: 0, status: 'failed', tokenCost: 50 });
    mockedDb.contentVariant.updateMany.mockResolvedValue({ count: 1 });
    mockedDb.contentVariant.findUniqueOrThrow.mockResolvedValue({ id: 'variant_0' });

    await retryContentVariant('piece_1', 0, { ...replacement, tokenCost: 30 });

    expect(mockedDb.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_1' },
      data: expect.objectContaining({
        tokenCost: { increment: 30 },
        draftContent: { body: 'replacement' },
        status: 'needs_review',
        failureReason: null,
      }),
    });
  });

  it.each([
    ['missing', null, { count: 1 }],
    ['not failed', { id: 'variant_1', index: 1, status: 'needs_review', tokenCost: 100 }, { count: 1 }],
    ['already updated', { id: 'variant_1', index: 1, status: 'failed', tokenCost: 100 }, { count: 0 }],
  ])('rejects a %s retry conflict without updating the parent', async (_label, existing, updateResult) => {
    mockedDb.contentVariant.findUnique.mockResolvedValue(existing);
    mockedDb.contentVariant.updateMany.mockResolvedValue(updateResult);

    await expect(retryContentVariant('piece_1', 1, replacement)).rejects.toBeInstanceOf(ContentVariantRetryConflictError);
    expect(mockedDb.contentPiece.update).not.toHaveBeenCalled();
  });
});

// Phase 2F S3 follow-up: a pre-S2 piece has no ContentVariant rows at all, so its retry must
// write directly onto ContentPiece using the same CAS + increment discipline.
describe('retryLegacyContentPiece', () => {
  const replacement = {
    draftContent: { body: 'replacement' },
    status: 'needs_review' as const,
    failureReason: null,
    tokenCost: 40,
    proofChecks: [{ check: 'disclosure', outcome: 'pass' }],
  };

  it('increments the piece-level tokenCost and writes the new draft directly onto ContentPiece', async () => {
    mockedDb.contentPiece.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'piece_1', status: 'failed', tokenCost: 20 })
      .mockResolvedValueOnce({ id: 'piece_1', status: 'needs_review', tokenCost: 60 });
    mockedDb.contentPiece.updateMany.mockResolvedValue({ count: 1 });

    const result = await retryLegacyContentPiece('piece_1', replacement);

    expect(mockedDb.contentPiece.updateMany).toHaveBeenCalledWith({
      where: { id: 'piece_1', status: 'failed', tokenCost: 20 },
      data: expect.objectContaining({
        draftContent: { body: 'replacement' },
        status: 'needs_review',
        failureReason: null,
        tokenCost: { increment: 40 },
      }),
    });
    expect(result.tokenCost).toBe(60);
  });

  it('rejects a concurrent retry on the same legacy piece without writing', async () => {
    mockedDb.contentPiece.findUniqueOrThrow.mockResolvedValueOnce({ id: 'piece_1', status: 'failed', tokenCost: 20 });
    mockedDb.contentPiece.updateMany.mockResolvedValue({ count: 0 });

    await expect(retryLegacyContentPiece('piece_1', replacement)).rejects.toBeInstanceOf(ContentVariantRetryConflictError);
  });
});
