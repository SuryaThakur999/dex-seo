// src/app/studio/page.tsx
import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { db } from '@/lib/db';
import { UtilityBar } from '@/components/app-shell/utility-bar';
import { ContentStudioShell, type ContentPieceView } from '@/components/content-studio/content-studio-shell';
import { ALL_PLATFORMS } from '@/lib/content-studio/registry';
import { defaultStudioWebsite, isPendingWebsite, selectableWebsites } from '@/lib/website-selection';
import type { ContentPlatform } from '@prisma/client';

export default async function StudioPage({
  searchParams,
}: {
  searchParams: { websiteId?: string; actionId?: string; sourceFindingId?: string; platform?: string; topic?: string };
}) {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  let website, websites;
  try {
    ({ website, websites } = await resolveWebsiteForRequest(userId, searchParams.websiteId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) return notFound();
    throw err;
  }
  website = defaultStudioWebsite(website, websites, searchParams.websiteId);
  const pickable = selectableWebsites(websites).map((w) => ({ id: w.id, url: w.url }));

  const clientProfile = await db.clientProfile.findFirst({ where: { id: website.clientProfileId } });
  if (!clientProfile) return null;

  const [pieces, pendingActions, findings] = await Promise.all([
    db.contentPiece.findMany({
      where: { clientProfileId: clientProfile.id, websiteId: website.id },
      orderBy: { createdAt: 'desc' },
      include: {
        sourceAction: { select: { pageUrl: true, actionType: true } },
        variants: { orderBy: { index: 'asc' } },
      },
    }),
    db.action.findMany({
      where: { websiteId: website.id, status: 'pending' },
      select: { id: true, pageUrl: true, actionType: true },
      take: 50,
    }),
    db.finding.findMany({
      where: { websiteId: website.id },
      orderBy: { retrievedAt: 'desc' },
      select: { id: true, ruleId: true, pageUrl: true },
      take: 50,
    }),
  ]);

  const initialPlatform = ALL_PLATFORMS.includes(searchParams.platform as ContentPlatform)
    ? (searchParams.platform as ContentPlatform)
    : undefined;

  const initialSourceActionId = pendingActions.some((a) => a.id === searchParams.actionId)
    ? searchParams.actionId
    : undefined;

  // Phase 2F S3: a dashboard opportunity link may carry a real Finding id, but only honor it
  // when that finding actually belongs to this website — same ownership-check discipline as
  // initialSourceActionId above, never trust a client-supplied id as proof of scope.
  const initialSourceFindingId = findings.some((f) => f.id === searchParams.sourceFindingId)
    ? searchParams.sourceFindingId
    : undefined;

  const initialPieces: ContentPieceView[] = pieces.map((p) => ({
    id: p.id,
    platform: p.platform,
    topic: p.topic,
    status: p.status,
    failureReason: p.failureReason,
    draftContent: p.draftContent,
    audience: p.audience,
    objective: p.objective,
    market: p.market,
    language: p.language,
    tokenCost: p.tokenCost,
    proofChecks: p.proofChecks as unknown as ContentPieceView['proofChecks'],
    createdAt: p.createdAt.toISOString(),
    sourceAction: p.sourceAction,
    evidence: p.evidence,
    variants: p.variants.map((v) => ({
      index: v.index,
      angle: v.angle,
      draftContent: v.draftContent,
      status: v.status,
      failureReason: v.failureReason,
      tokenCost: v.tokenCost,
      proofChecks: v.proofChecks as unknown as ContentPieceView['proofChecks'],
    })),
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <UtilityBar
        websiteUrl={website.url}
        gscConnected={Boolean(website.gscRefreshToken)}
        lastRefresh={null}
        websites={pickable}
        currentWebsiteId={website.id}
        profileName={clientProfile.name}
        switcherHrefPattern="/studio?websiteId={id}"
      />
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Content Studio</h1>
        <p className="text-sm text-muted-foreground">Turn verified opportunities into platform-ready content.</p>
      </div>
      <ContentStudioShell
        clientProfileId={clientProfile.id}
        websiteId={website.id}
        websiteUrl={website.url}
        websites={pickable}
        websiteConfirmed={!isPendingWebsite(website)}
        profileName={clientProfile.name}
        findings={findings}
        initialPieces={initialPieces}
        pendingActions={pendingActions}
        clientProfileDefaults={{ audience: clientProfile.audience, markets: clientProfile.markets, languages: clientProfile.languages }}
        initialPlatform={initialPlatform}
        initialTopic={searchParams.topic}
        initialSourceActionId={initialSourceActionId}
        initialSourceFindingId={initialSourceFindingId}
      />
    </div>
  );
}
