import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateContentVariant, type VariantAngleIndex } from '@/lib/content-studio/generate-variants';
import { ContentVariantRetryConflictError, retryContentVariant, retryLegacyContentPiece } from '@/lib/content-studio/persist-variants';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { readFindingEvidence } from '@/lib/content-studio/evidence';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'A variant index is required' }, { status: 400 });
  }
  const index = body && typeof body === 'object' && 'index' in body
    ? (body as { index?: unknown }).index
    : undefined;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 2) {
    return NextResponse.json({ error: 'index must be 0, 1, or 2' }, { status: 400 });
  }
  const variantIndex = index as VariantAngleIndex;

  const piece = await db.contentPiece.findFirst({
    where: { id: params.id, clientProfile: { customer: { clerkUserId: userId } } },
    include: {
      clientProfile: {
        select: {
          id: true,
          brandVoice: true,
          businessDescription: true,
          audience: true,
          approvedClaims: true,
          restrictedWording: true,
          markets: true,
          languages: true,
        },
      },
      variants: { orderBy: { index: 'asc' } },
    },
  });
  if (!piece) {
    return NextResponse.json({ error: 'Content piece not found' }, { status: 403 });
  }
  // A piece created before S2's variant table existed has variants: [] forever — it only
  // ever had its own single draft at index 0, so that's the only retriable index for it.
  const isLegacyPiece = piece.variants.length === 0;
  if (isLegacyPiece) {
    if (variantIndex !== 0) return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    if (piece.status !== 'failed') {
      return NextResponse.json({ error: 'This variant is not retriable' }, { status: 409 });
    }
  } else {
    const selectedVariant = piece.variants.find((variant) => variant.index === variantIndex);
    if (!selectedVariant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    if (selectedVariant.status !== 'failed') {
      return NextResponse.json({ error: 'This variant is not retriable' }, { status: 409 });
    }
  }
  if (!piece.websiteId) {
    return NextResponse.json({ error: 'This draft has no stored website. Create a new draft for the selected website.' }, { status: 400 });
  }
  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, piece.websiteId, piece.clientProfileId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 403 });
    }
    throw err;
  }

  let sourceAction: { pageUrl: string; actionType: string; draftContent: string } | null = null;
  if (piece.sourceActionId) {
    sourceAction = await db.action.findFirst({
      where: {
        id: piece.sourceActionId,
        websiteId: piece.websiteId,
        website: { clientProfileId: piece.clientProfileId },
        customer: { clerkUserId: userId },
      },
      select: { pageUrl: true, actionType: true, draftContent: true },
    });
    if (!sourceAction) {
      return NextResponse.json({ error: 'Source action not found' }, { status: 403 });
    }
  }

  if (piece.sourceFindingId) {
    const finding = await db.finding.findFirst({
      where: {
        id: piece.sourceFindingId,
        websiteId: piece.websiteId,
        website: { clientProfileId: piece.clientProfileId },
        customer: { clerkUserId: userId },
      },
      select: { id: true },
    });
    if (!finding) return NextResponse.json({ error: 'Source finding not found' }, { status: 403 });
  }

  try {
    const generated = await generateContentVariant({
      websiteId: piece.websiteId,
      websiteUrl: website.url,
      clientProfile: piece.clientProfile,
      platform: piece.platform,
      topic: piece.topic,
      sourceAction,
      sourceFinding: readFindingEvidence(piece.evidence),
      audience: piece.audience,
      objective: piece.objective,
      market: piece.market,
      language: piece.language,
    }, variantIndex);
    if (isLegacyPiece) {
      await retryLegacyContentPiece(piece.id, {
        draftContent: generated.draftContent,
        status: generated.status,
        failureReason: generated.failureReason,
        tokenCost: generated.tokenCost,
        proofChecks: generated.proofChecks,
      });
    } else {
      await retryContentVariant(piece.id, variantIndex, {
        angle: generated.angle,
        draftContent: generated.draftContent,
        status: generated.status,
        failureReason: generated.failureReason,
        critique: generated.critique,
        tokenCost: generated.tokenCost,
        proofChecks: generated.proofChecks,
      });
    }
    const updated = await db.contentPiece.findUnique({
      where: { id: piece.id },
      include: { variants: { orderBy: { index: 'asc' } } },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ContentVariantRetryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error('Content Studio retry failed:', err);
    return NextResponse.json({ error: 'Retry failed' }, { status: 500 });
  }
}
