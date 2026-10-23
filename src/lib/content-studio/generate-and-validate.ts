import { db } from '@/lib/db';
import type { ClientProfile, ContentPlatform } from '@prisma/client';
import { getAdapter } from './registry';
import { generateContentDraft } from './draft-generator';
import { ContentGenerationError } from './generation-error';
import { runContentProofLayer } from './run-content-proof-layer';
import type { DraftPromptInput, SourceActionContext } from './adapter-types';
import type { ProofCheckResult } from '@/lib/proof-layer';
import type { VariantAngleIndex } from './variant-angles';
import type { ReviseDraftInput } from './revise';

export interface GenerateContentPieceInput {
  angleIndex?: VariantAngleIndex;
  websiteId: string;
  websiteUrl?: string;
  clientProfile: Pick<
    ClientProfile,
    'id' | 'brandVoice' | 'audience' | 'approvedClaims' | 'restrictedWording' | 'markets' | 'languages'
  > & Partial<Pick<ClientProfile, 'businessDescription'>>;
  platform: ContentPlatform;
  topic: string;
  sourceAction: SourceActionContext | null;
  sourceFinding?: DraftPromptInput['sourceFinding'];
  audience: string | null;
  objective: string | null;
  market: string | null;
  language: string | null;
}

export interface GenerateContentPieceResult {
  draft: unknown;
  tokenCost: number;
  status: 'draft' | 'needs_assets' | 'needs_review';
  failureReason: string | null;
  // Null only when the format check itself failed (needs_assets) — there is no
  // real draft text yet to run the proof layer against.
  proofChecks: ProofCheckResult[] | null;
}

/**
 * Shared by the create route and the retry route: generate one draft, validate its shape, and
 * (when it validates) run the real ProofLayer against it — including duplicate-risk against this
 * client's own recent same-platform drafts. Extracted so a retry re-runs the identical pipeline
 * `run-scan.ts`'s retry-draft route already established as the project's pattern, rather than a
 * second, subtly different generation path.
 */
export async function generateAndValidateContentPiece(
  input: GenerateContentPieceInput,
  revision?: ReviseDraftInput,
): Promise<GenerateContentPieceResult> {
  const adapter = getAdapter(input.platform);
  const promptInput: DraftPromptInput = {
    topic: input.topic,
    websiteUrl: input.websiteUrl,
    clientProfile: input.clientProfile,
    sourceAction: input.sourceAction,
    sourceFinding: input.sourceFinding,
    audience: input.audience,
    objective: input.objective,
    market: input.market,
    language: input.language,
  };

  const { draft, tokenCost } = revision
    ? await generateContentDraft(adapter, promptInput, undefined, input.angleIndex, revision)
    : input.angleIndex === undefined
    ? await generateContentDraft(adapter, promptInput)
    : await generateContentDraft(adapter, promptInput, undefined, input.angleIndex);
  try {
    const validation = adapter.validate(draft as never);

    let status: 'draft' | 'needs_assets' | 'needs_review' = validation.valid ? 'draft' : 'needs_assets';
    let failureReason: string | null = null;
    let proofChecks: ProofCheckResult[] | null = null;

    if (validation.valid) {
      const recentPieces = await db.contentPiece.findMany({
        where: { clientProfileId: input.clientProfile.id, websiteId: input.websiteId, platform: input.platform },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { draftContent: true },
      });
      // Failed generations can leave {} in history. Skip drafts the adapter cannot export.
      const recentDraftTexts = recentPieces.flatMap((p) => {
        try {
          return [adapter.formatExport(p.draftContent as never)];
        } catch {
          return [];
        }
      });
      const proofResult = runContentProofLayer({
        platform: input.platform,
        draftText: adapter.formatExport(draft as never),
        rawDraft: draft,
        approvedFacts: input.clientProfile.approvedClaims,
        restrictedWording: input.clientProfile.restrictedWording,
        recentDraftTexts,
      });
      proofChecks = proofResult.checksRun;
      if (proofResult.outcome !== 'pass') {
        status = 'needs_review';
        failureReason = `ProofLayer ${proofResult.outcome}: ${proofResult.reasoning}`;
      }
    }

    return { draft, tokenCost, status, failureReason, proofChecks };
  } catch (cause) {
    throw new ContentGenerationError(
      cause instanceof Error ? cause.message : 'Content validation failed',
      tokenCost,
      cause,
    );
  }
}
