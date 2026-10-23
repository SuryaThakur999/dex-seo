import { Prisma, type ContentStatus } from '@prisma/client';
import { db } from '@/lib/db';

export interface VariantGenerationResult {
  index: number;
  angle: string;
  draftContent: unknown;
  status: ContentStatus;
  failureReason: string | null;
  critique: unknown | null;
  tokenCost: number;
  proofChecks: unknown | null;
}

export class ContentVariantRetryConflictError extends Error {}

function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function variantData(contentPieceId: string, variant: VariantGenerationResult) {
  return {
    contentPieceId,
    index: variant.index,
    angle: variant.angle,
    draftContent: variant.draftContent as Prisma.InputJsonValue,
    status: variant.status,
    failureReason: variant.failureReason,
    critique: toJsonInput(variant.critique),
    tokenCost: variant.tokenCost,
    proofChecks: toJsonInput(variant.proofChecks),
  };
}

export async function createContentPieceWithVariants(
  piece: Omit<Prisma.ContentPieceUncheckedCreateInput, 'tokenCost'>,
  variants: VariantGenerationResult[],
) {
  if (variants.length !== 3 || variants.some((variant, index) => variant.index !== index)) {
    throw new Error('Content generation must persist variants at stable indexes 0, 1, and 2');
  }

  return db.$transaction(async (tx) => {
    const createdPiece = await tx.contentPiece.create({
      data: {
        ...piece,
        tokenCost: variants.reduce((sum, variant) => sum + variant.tokenCost, 0),
      },
    });
    const createdVariants = [];
    for (const variant of variants) {
      createdVariants.push(await tx.contentVariant.create({ data: variantData(createdPiece.id, variant) }));
    }
    return { ...createdPiece, variants: createdVariants };
  });
}

export async function persistContentVariants(contentPieceId: string, variants: VariantGenerationResult[]) {
  return db.$transaction(async (tx) => {
    const created = [];
    for (const variant of variants) {
      created.push(
        await tx.contentVariant.create({
          data: variantData(contentPieceId, variant),
        })
      );
    }
    const aggregateTokenCost = variants.reduce((sum, variant) => sum + variant.tokenCost, 0);
    await tx.contentPiece.update({
      where: { id: contentPieceId },
      data: { tokenCost: aggregateTokenCost },
    });
    return created;
  });
}

// Phase 2F S3 follow-up: a piece created before S2's variant table existed has an empty
// `variants` array forever (no migration backfilled one) — it only ever had its own
// draftContent/status/tokenCost. Retry for one of these mirrors retryContentVariant's CAS +
// increment discipline directly onto ContentPiece, since there is no ContentVariant row to key
// off. Index 0 only: a legacy piece never had more than one draft to retry.
export async function retryLegacyContentPiece(
  contentPieceId: string,
  update: Omit<VariantGenerationResult, 'index' | 'angle' | 'critique'>
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.contentPiece.findUniqueOrThrow({ where: { id: contentPieceId } });
    const result = await tx.contentPiece.updateMany({
      where: { id: contentPieceId, status: 'failed', tokenCost: existing.tokenCost },
      data: {
        draftContent: update.draftContent as Prisma.InputJsonValue,
        status: update.status,
        failureReason: update.failureReason,
        tokenCost: { increment: update.tokenCost },
        proofChecks: toJsonInput(update.proofChecks),
      },
    });
    if (result.count === 0) {
      throw new ContentVariantRetryConflictError('Content piece was already updated');
    }
    return tx.contentPiece.findUniqueOrThrow({ where: { id: contentPieceId } });
  });
}

export async function retryContentVariant(
  contentPieceId: string,
  variantIndex: number,
  update: Omit<VariantGenerationResult, 'index'>
) {
  return db.$transaction(async (tx) => {
    const existing = await tx.contentVariant.findUnique({
      where: { contentPieceId_index: { contentPieceId, index: variantIndex } },
    });
    if (!existing) {
      throw new ContentVariantRetryConflictError(`No variant at index ${variantIndex}`);
    }

    if (existing.status !== 'failed') {
      throw new ContentVariantRetryConflictError(`Variant at index ${variantIndex} is not retriable`);
    }

    const result = await tx.contentVariant.updateMany({
      where: { contentPieceId, index: variantIndex, status: 'failed', tokenCost: existing.tokenCost },
      data: {
        draftContent: update.draftContent as Prisma.InputJsonValue,
        status: update.status,
        failureReason: update.failureReason,
        critique: toJsonInput(update.critique),
        tokenCost: { increment: update.tokenCost },
        proofChecks: toJsonInput(update.proofChecks),
      },
    });
    if (result.count === 0) {
      throw new ContentVariantRetryConflictError(`Variant at index ${variantIndex} was already updated`);
    }

    await tx.contentPiece.update({
      where: { id: contentPieceId },
      data: variantIndex === 0
        ? {
            tokenCost: { increment: update.tokenCost },
            draftContent: update.draftContent as Prisma.InputJsonValue,
            status: update.status,
            failureReason: update.failureReason,
            proofChecks: toJsonInput(update.proofChecks),
          }
        : { tokenCost: { increment: update.tokenCost } },
    });

    return tx.contentVariant.findUniqueOrThrow({
      where: { contentPieceId_index: { contentPieceId, index: variantIndex } },
    });
  });
}
