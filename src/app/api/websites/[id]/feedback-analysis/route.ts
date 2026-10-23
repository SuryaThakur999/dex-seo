import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import {
  extractEligibleEdits,
  computeSourceFingerprint,
  generateFeedbackSummary,
  MIN_EDITS_FOR_SUMMARY,
  PROMPT_VERSION,
  SUMMARY_MODEL,
} from '@/lib/feedback-analysis';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, params.id));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  const editedActions = await db.action.findMany({
    where: { websiteId: website.id, status: 'edited' },
    select: { id: true, actionType: true, draftContent: true },
  });
  const actionsById = new Map(editedActions.map((a) => [a.id, { actionType: a.actionType, draftContent: a.draftContent }]));

  const auditEntries = await db.auditLogEntry.findMany({
    where: { actionId: { in: editedActions.map((a) => a.id) }, eventType: 'action_decided' },
    select: { id: true, actionId: true, detail: true, createdAt: true },
  });

  const eligibleEdits = extractEligibleEdits(auditEntries, actionsById);

  if (eligibleEdits.length < MIN_EDITS_FOR_SUMMARY) {
    return NextResponse.json({
      summary: null,
      sourceEditCount: eligibleEdits.length,
      generatedAt: null,
      belowThreshold: true,
      needed: MIN_EDITS_FOR_SUMMARY - eligibleEdits.length,
    });
  }

  const summary = await generateFeedbackSummary(eligibleEdits);
  const fingerprint = computeSourceFingerprint(eligibleEdits);
  const latestEntryAt = eligibleEdits[0]?.timestamp ?? null;
  const generatedAt = new Date();

  await db.feedbackAnalysis.upsert({
    where: { websiteId: website.id },
    create: {
      websiteId: website.id,
      summary,
      sourceEditCount: eligibleEdits.length,
      sourceLatestEntryAt: latestEntryAt,
      sourceFingerprint: fingerprint,
      modelVersion: SUMMARY_MODEL,
      promptVersion: PROMPT_VERSION,
      generatedAt,
    },
    // generatedAt has no update-time default in the schema (`@default(now())` only fires on
    // insert) -- without setting it explicitly here, a re-analysis persists the row's original
    // creation timestamp forever, so the next page load shows the wrong (first-ever) date even
    // though this response correctly reflects "now".
    update: {
      summary,
      sourceEditCount: eligibleEdits.length,
      sourceLatestEntryAt: latestEntryAt,
      sourceFingerprint: fingerprint,
      modelVersion: SUMMARY_MODEL,
      promptVersion: PROMPT_VERSION,
      generatedAt,
    },
  });

  return NextResponse.json({
    summary,
    sourceEditCount: eligibleEdits.length,
    generatedAt: generatedAt.toISOString(),
    belowThreshold: false,
    needed: 0,
  });
}
