import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ALL_PLATFORMS } from '@/lib/content-studio/registry';
import { generateContentVariants } from '@/lib/content-studio/generate-variants';
import { createContentPieceWithVariants } from '@/lib/content-studio/persist-variants';
import type { DraftPromptInput } from '@/lib/content-studio/adapter-types';
import type { ContentPlatform } from '@prisma/client';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import type { FindingEvidence } from '@/lib/content-studio/evidence';

// The topic is embedded verbatim in every adapter's prompt, so it is a paid
// input; cap it before forwarding it to the model.
const MAX_TOPIC_LENGTH = 500;

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const { clientProfileId, websiteId, platform, topic, sourceActionId, sourceFindingId, sourceRecommendationId, audience, objective, market, language } = body;

  if (typeof clientProfileId !== 'string' || typeof topic !== 'string' || !topic.trim()) {
    return NextResponse.json({ error: 'clientProfileId and topic are required' }, { status: 400 });
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    return NextResponse.json({ error: 'Topic must be 500 characters or fewer.' }, { status: 400 });
  }
  if (!ALL_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: 'Unknown platform' }, { status: 400 });
  }
  if (websiteId !== undefined && (typeof websiteId !== 'string' || !websiteId.trim())) {
    return NextResponse.json({ error: 'websiteId must be a non-empty string' }, { status: 400 });
  }
  if (sourceFindingId != null && (typeof sourceFindingId !== 'string' || !sourceFindingId.trim())) {
    return NextResponse.json({ error: 'sourceFindingId must be a non-empty string' }, { status: 400 });
  }
  if (sourceRecommendationId != null && (typeof sourceRecommendationId !== 'string' || !sourceRecommendationId.trim())) {
    return NextResponse.json({ error: 'sourceRecommendationId must be a non-empty string' }, { status: 400 });
  }

  const clientProfile = await db.clientProfile.findFirst({
    where: { id: clientProfileId, customer: { clerkUserId: userId } },
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
  });
  if (!clientProfile) {
    return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });
  }

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, websiteId, clientProfileId));
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 403 });
    }
    throw error;
  }

  let sourceAction: DraftPromptInput['sourceAction'] = null;
  if (typeof sourceActionId === 'string' && sourceActionId) {
    const action = await db.action.findFirst({
      // Scoped through website → clientProfile as well as the owning customer:
      // an agency workspace holds several client profiles, and one client's
      // finding must never become grounding context in another's prompt.
      where: { id: sourceActionId, websiteId: website.id, website: { clientProfileId }, customer: { clerkUserId: userId } },
      select: { pageUrl: true, actionType: true, draftContent: true },
    });
    if (!action) {
      return NextResponse.json({ error: 'Source action not found' }, { status: 403 });
    }
    sourceAction = action;
  }

  const resolvedAudience = optionalString(audience);
  let sourceFinding: FindingEvidence | null = null;
  if (sourceFindingId) {
    const finding = await db.finding.findFirst({
      where: { id: sourceFindingId, websiteId: website.id, website: { clientProfileId }, customer: { clerkUserId: userId } },
      select: { id: true, ruleId: true, pageUrl: true, retrievedAt: true, evidence: true, limitations: true },
    });
    if (!finding) return NextResponse.json({ error: 'Source finding not found' }, { status: 403 });
    sourceFinding = {
      kind: 'finding', findingId: finding.id, ruleId: finding.ruleId, pageUrl: finding.pageUrl,
      retrievedAt: finding.retrievedAt.toISOString(), evidence: finding.evidence, limitations: finding.limitations,
    };
  }
  if (sourceRecommendationId) {
    const recommendation = await db.contentRecommendation.findFirst({
      where: { id: sourceRecommendationId, websiteId: website.id, clientProfileId },
      select: { id: true },
    });
    if (!recommendation) return NextResponse.json({ error: 'Source recommendation not found' }, { status: 403 });
  }
  const evidenceFields = sourceFinding ? { sourceFindingId: sourceFinding.findingId, evidence: sourceFinding as never } : {};
  const resolvedObjective = optionalString(objective);
  const resolvedMarket = optionalString(market);
  const resolvedLanguage = optionalString(language);

  const variants = await generateContentVariants({
      websiteId: website.id,
      websiteUrl: website.url,
      clientProfile,
      platform: platform as ContentPlatform,
      topic,
      sourceAction,
      sourceFinding,
      audience: resolvedAudience,
      objective: resolvedObjective,
      market: resolvedMarket,
      language: resolvedLanguage,
  });
  const representative = variants[0];
  const piece = await createContentPieceWithVariants({
      clientProfileId,
      websiteId: website.id,
      platform: platform as ContentPlatform,
      topic,
      sourceActionId: sourceActionId || null,
      sourceRecommendationId: sourceRecommendationId || null,
      ...evidenceFields,
      draftContent: representative.draftContent as never,
      status: representative.status,
      failureReason: representative.failureReason,
      audience: resolvedAudience,
      objective: resolvedObjective,
      market: resolvedMarket,
      language: resolvedLanguage,
      proofChecks: representative.proofChecks as never,
    }, variants);
  return NextResponse.json(piece);
}

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const searchParams = new URL(req.url).searchParams;
  const clientProfileId = searchParams.get('clientProfileId');
  const websiteId = searchParams.get('websiteId');
  if (!clientProfileId) {
    return NextResponse.json({ error: 'clientProfileId is required' }, { status: 400 });
  }
  if (websiteId !== null && !websiteId.trim()) {
    return NextResponse.json({ error: 'websiteId must be a non-empty string' }, { status: 400 });
  }

  const clientProfile = await db.clientProfile.findFirst({
    where: { id: clientProfileId, customer: { clerkUserId: userId } },
    select: { id: true },
  });
  if (!clientProfile) {
    return NextResponse.json({ error: 'Client profile not found' }, { status: 403 });
  }

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, websiteId ?? undefined, clientProfileId));
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 403 });
    }
    throw error;
  }

  const pieces = await db.contentPiece.findMany({
    where: { clientProfileId, websiteId: website.id },
    orderBy: { createdAt: 'desc' },
    include: { variants: { orderBy: { index: 'asc' } } },
  });
  return NextResponse.json(pieces);
}
