import { generateAndValidateContentPiece, type GenerateContentPieceInput } from './generate-and-validate';
import { getGenerationTokenCost } from './generation-error';
import type { VariantGenerationResult } from './persist-variants';
import { getVariantAngle, VARIANT_ANGLE_INDICES, type VariantAngleIndex } from './variant-angles';
export type { VariantAngleIndex };
import { getCustomerSafeGenerationError } from '@/lib/customer-safe-error';
import { critiqueDraft, type CritiqueResult } from './critique';
import { getAdapter } from './registry';

function critique(input: GenerateContentPieceInput, draft: unknown): CritiqueResult {
  const fields = draft as Record<string, unknown>;
  const fullText = getAdapter(input.platform).formatExport(draft as never);
  const posts = Array.isArray(fields.posts) ? fields.posts.filter((post): post is string => typeof post === 'string') : [];
  const lines = fullText.split('\n').filter(line => line.trim());
  return critiqueDraft({
    platform: input.platform, objective: input.objective, fullText,
    hook: typeof fields.hook === 'string' ? fields.hook : posts[0] ?? lines[0] ?? '',
    cta: typeof fields.cta === 'string' ? fields.cta : posts.at(-1) ?? lines.at(-1) ?? '',
    structure: typeof fields.structure === 'string' ? fields.structure : undefined,
  });
}

export async function generateContentVariants(
  input: Omit<GenerateContentPieceInput, 'angleIndex'>,
): Promise<VariantGenerationResult[]> {
  return Promise.all(VARIANT_ANGLE_INDICES.map(index => generateContentVariant(input, index)));
}

export async function generateContentVariant(
  input: Omit<GenerateContentPieceInput, 'angleIndex'>,
  index: VariantAngleIndex,
): Promise<VariantGenerationResult> {
    const angle = getVariantAngle(index).label;
    let tokenCost = 0;
    let assessment: CritiqueResult | null = null;
    try {
      const variantInput = { ...input, angleIndex: index };
      let result = await generateAndValidateContentPiece(variantInput);
      tokenCost += result.tokenCost;
      if (result.status === 'draft') {
        assessment = critique(variantInput, result.draft);
        if (assessment.fixes.length) {
          result = await generateAndValidateContentPiece(variantInput, {
            fullText: JSON.stringify(result.draft), critique: assessment,
          });
          tokenCost += result.tokenCost;
          assessment = result.status === 'draft' ? critique(variantInput, result.draft) : null;
        }
      }
      const needsRevision = result.status === 'draft' && Boolean(assessment?.fixes.length);
      return {
        index, angle, draftContent: result.draft, tokenCost,
        status: needsRevision ? 'needs_review' : result.status,
        failureReason: needsRevision ? 'Critique requires further review' : result.failureReason,
        critique: assessment, proofChecks: result.proofChecks,
      };
    } catch (error) {
      return {
        index, angle, draftContent: {}, status: 'failed',
        failureReason: getCustomerSafeGenerationError(error),
        critique: assessment, tokenCost: tokenCost + getGenerationTokenCost(error), proofChecks: null,
      };
    }
}
