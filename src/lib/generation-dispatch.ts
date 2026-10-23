import type { ProofOutcome } from '@prisma/client';
import { draftMetaDescription } from '@/lib/creation-engine';
import { runProofLayer, decideActionStatus, deriveRiskTier } from '@/lib/proof-layer';
import {
  generateCanonicalFix,
  validateCanonicalFix,
  generateStructuredDataFix,
  generateEntityMarkupFix,
  validateJsonLdFix,
} from '@/lib/deterministic-remediation';
import { draftRestrictedWordingFix } from '@/lib/restricted-wording-fix';
import { draftInternalLinkFix } from '@/lib/internal-link-fix';
import type { GenerationPayload } from '@/lib/generation-payload';

// Phase 1C (docs/superpowers/specs/2026-09-28-phase1c-generation-queue-adr.md): one function
// per actionType, each producing the same shape generation-worker.ts writes into an Action row.
// This module owns ONLY the orchestration that used to sit inline in run-scan.ts's per-page
// loop -- every real generator/validator call below is the same function run-scan.ts already
// called, relocated so both the scan loop and the queue worker (and, transitively, retry-draft)
// share one implementation instead of two copies that could drift.
// Per docs/superpowers/plans/2026-10-12-action-provenance-producer-wiring-note.md -- every
// producer fills this in the same shape so generation-worker.ts's success transaction can write
// one ActionProvenance row without per-actionType branching on what was actually consumed.
export interface GenerationProvenance {
  producerKind: 'model' | 'deterministic';
  producerVersion: string;
  findingAssociation: 'causal' | 'input_only' | 'unavailable';
  associationReason: string | null;
  generatorInputsSnapshot: unknown;
  generatorInputsVersion: string;
  validatorInputsSnapshot: unknown | null;
  validatorInputsVersion: string | null;
}

export interface GenerationOutcome {
  currentValue: string | null;
  draftContent: string;
  aiDisclosure: boolean;
  tokenCost: number | null;
  status: 'pending' | 'approved';
  riskTier: 'low' | 'medium' | 'high';
  guardResult: { outcome: ProofOutcome; checksRun: unknown; reasoning: string };
  provenance: GenerationProvenance;
}

// meta_description is flagged by growth-brain.ts's pure flagPages() heuristic, never by a
// Finding row -- GenerationPayload's meta_description variant has findingId typed `null` for
// exactly this reason, so there's nothing to branch on here.
const META_DESCRIPTION_NO_FINDING_REASON =
  'meta_description is flagged by a heuristic (growth-brain.ts flagPages), not a Finding record';

function findingAssociationFor(findingId: string | null): { findingAssociation: 'causal' | 'unavailable'; associationReason: string | null } {
  return findingId
    ? { findingAssociation: 'causal', associationReason: null }
    : { findingAssociation: 'unavailable', associationReason: 'no Finding id was available at enqueue time' };
}

// Tenant-wide context, deliberately fetched fresh by the caller (generation-worker.ts) at claim
// time rather than baked into the job's payload -- a job that waits through a retry backoff
// should see the customer's current approved facts/restricted wording, not what was true when
// it was enqueued.
export interface GenerationContext {
  autoExecuteEnabled: boolean;
  approvedFacts: string[];
  restrictedWording: string[];
  clientProfileName: string | null;
  // Point-in-time snapshot for ActionProvenance.clientProfileIdAtExecution -- not meant for any
  // generator/validator logic, which is why it's absent from every producer's inputsSnapshot.
  clientProfileId: string;
  recentDraftsForCustomer?: string[];
}

async function generateMetaDescriptionOutcome(
  payload: Extract<GenerationPayload, { actionType: 'meta_description' }>,
  ctx: GenerationContext
): Promise<GenerationOutcome> {
  const { draftContent, tokenCost } = await draftMetaDescription({
    url: payload.url,
    title: payload.title,
    metaDescription: payload.metaDescription,
    h1: payload.h1,
  });

  const guardResult = runProofLayer({
    draftContent,
    sourceContent: { title: payload.title, metaDescription: payload.metaDescription },
    aiDisclosure: true,
    recentDraftsForCustomer: ctx.recentDraftsForCustomer ?? [],
    approvedFacts: ctx.approvedFacts,
    restrictedWording: ctx.restrictedWording,
  });

  return {
    currentValue: payload.metaDescription,
    draftContent,
    aiDisclosure: true,
    tokenCost,
    status: decideActionStatus(guardResult.outcome, ctx.autoExecuteEnabled),
    riskTier: deriveRiskTier(guardResult.checksRun),
    guardResult,
    provenance: {
      producerKind: 'model',
      producerVersion: 'v1',
      findingAssociation: 'unavailable',
      associationReason: META_DESCRIPTION_NO_FINDING_REASON,
      generatorInputsSnapshot: { url: payload.url, title: payload.title, metaDescription: payload.metaDescription, h1: payload.h1 },
      generatorInputsVersion: 'v1',
      // Mirrors every argument actually passed to runProofLayer above (draftContent excluded --
      // already captured separately as ActionProvenance.checkedBytes) so this guard decision is
      // reconstructable later, not just its title/metaDescription inputs. Ryan's 2026-10-12 review.
      validatorInputsSnapshot: {
        sourceContent: { title: payload.title, metaDescription: payload.metaDescription },
        aiDisclosure: true,
        recentDraftsForCustomer: ctx.recentDraftsForCustomer ?? [],
        approvedFacts: ctx.approvedFacts,
        restrictedWording: ctx.restrictedWording,
      },
      validatorInputsVersion: 'v1',
    },
  };
}

async function generateCanonicalFixOutcome(
  payload: Extract<GenerationPayload, { actionType: 'canonical_fix' }>,
  ctx: GenerationContext
): Promise<GenerationOutcome> {
  const draftContent = generateCanonicalFix(payload.pageUrl);
  const validation = validateCanonicalFix(draftContent, payload.pageUrl);
  return {
    currentValue: payload.currentCanonical,
    draftContent,
    aiDisclosure: false,
    tokenCost: null,
    status: decideActionStatus(validation.outcome, ctx.autoExecuteEnabled),
    riskTier: 'low',
    guardResult: validation,
    provenance: {
      producerKind: 'deterministic',
      producerVersion: 'v1',
      ...findingAssociationFor(payload.findingId),
      generatorInputsSnapshot: { pageUrl: payload.pageUrl },
      generatorInputsVersion: 'v1',
      validatorInputsSnapshot: { draftContent, pageUrl: payload.pageUrl },
      validatorInputsVersion: 'v1',
    },
  };
}

async function generateStructuredDataFixOutcome(
  payload: Extract<GenerationPayload, { actionType: 'structured_data_fix' }>,
  ctx: GenerationContext
): Promise<GenerationOutcome> {
  const draftContent = generateStructuredDataFix(payload.pageUrl, payload.title);
  const validation = validateJsonLdFix(draftContent, 'WebPage', payload.pageUrl);
  return {
    currentValue: null,
    draftContent,
    aiDisclosure: false,
    tokenCost: null,
    status: decideActionStatus(validation.outcome, ctx.autoExecuteEnabled),
    riskTier: 'low',
    guardResult: validation,
    provenance: {
      producerKind: 'deterministic',
      producerVersion: 'v1',
      ...findingAssociationFor(payload.findingId),
      generatorInputsSnapshot: { pageUrl: payload.pageUrl, title: payload.title },
      generatorInputsVersion: 'v1',
      validatorInputsSnapshot: { draftContent, type: 'WebPage', pageUrl: payload.pageUrl },
      validatorInputsVersion: 'v1',
    },
  };
}

async function generateEntityMarkupFixOutcome(
  payload: Extract<GenerationPayload, { actionType: 'entity_markup_fix' }>,
  ctx: GenerationContext
): Promise<GenerationOutcome> {
  // Enqueueing only happens when run-scan.ts has already confirmed `clientProfile?.name` is
  // truthy (see its existing homepage-only guard) -- by the time a job reaches here, a missing
  // name is a real bug upstream, not a case to silently skip.
  if (!ctx.clientProfileName) {
    throw new Error('entity_markup_fix job claimed with no ClientProfile.name in context');
  }
  const draftContent = generateEntityMarkupFix(payload.pageUrl, ctx.clientProfileName);
  const validation = validateJsonLdFix(draftContent, 'Organization', payload.pageUrl);
  return {
    currentValue: null,
    draftContent,
    aiDisclosure: false,
    tokenCost: null,
    status: decideActionStatus(validation.outcome, ctx.autoExecuteEnabled),
    riskTier: 'low',
    guardResult: validation,
    provenance: {
      producerKind: 'deterministic',
      producerVersion: 'v1',
      ...findingAssociationFor(payload.findingId),
      generatorInputsSnapshot: { pageUrl: payload.pageUrl, clientProfileName: ctx.clientProfileName },
      generatorInputsVersion: 'v1',
      validatorInputsSnapshot: { draftContent, type: 'Organization', pageUrl: payload.pageUrl },
      validatorInputsVersion: 'v1',
    },
  };
}

async function generateRestrictedWordingFixOutcome(
  payload: Extract<GenerationPayload, { actionType: 'restricted_wording_fix' }>,
  ctx: GenerationContext
): Promise<GenerationOutcome> {
  const currentValue = payload.matches.map((m) => m.excerpt).join('\n');
  const { draftContent, tokenCost } = await draftRestrictedWordingFix(payload.matches);

  const guardResult = runProofLayer({
    draftContent,
    sourceContent: { title: payload.title, metaDescription: payload.metaDescription },
    aiDisclosure: true,
    recentDraftsForCustomer: [],
    approvedFacts: [...ctx.approvedFacts, ...payload.matches.map((m) => m.excerpt)],
    restrictedWording: ctx.restrictedWording,
  });

  return {
    currentValue,
    draftContent,
    aiDisclosure: true,
    tokenCost,
    status: decideActionStatus(guardResult.outcome, ctx.autoExecuteEnabled),
    riskTier: deriveRiskTier(guardResult.checksRun),
    guardResult,
    provenance: {
      producerKind: 'model',
      producerVersion: 'v1',
      ...findingAssociationFor(payload.findingId),
      generatorInputsSnapshot: { matches: payload.matches },
      generatorInputsVersion: 'v1',
      // Mirrors the real runProofLayer call above, including the matched excerpts folded into
      // approvedFacts -- a reviewer re-deriving this guard decision later needs the exact same
      // excerpts, not just the restrictedWording list. Ryan's 2026-10-12 review.
      validatorInputsSnapshot: {
        sourceContent: { title: payload.title, metaDescription: payload.metaDescription },
        aiDisclosure: true,
        recentDraftsForCustomer: [],
        approvedFacts: [...ctx.approvedFacts, ...payload.matches.map((m) => m.excerpt)],
        restrictedWording: ctx.restrictedWording,
      },
      validatorInputsVersion: 'v1',
    },
  };
}

async function generateInternalLinkFixOutcome(
  payload: Extract<GenerationPayload, { actionType: 'internal_link_fix' }>,
  ctx: GenerationContext
): Promise<GenerationOutcome> {
  const { draftContent, tokenCost } = await draftInternalLinkFix(
    { url: payload.targetUrl, title: payload.targetTitle },
    payload.candidates
  );

  const guardResult = runProofLayer({
    draftContent,
    sourceContent: { title: payload.targetTitle, metaDescription: null },
    aiDisclosure: true,
    recentDraftsForCustomer: [],
    approvedFacts: [...ctx.approvedFacts, ...payload.candidates.map((c) => `${c.url} ${c.title ?? ''}`)],
    restrictedWording: ctx.restrictedWording,
  });

  return {
    // No "current" value to diff against -- this recommends adding new links from other pages,
    // not editing the target page's own content (matches run-scan.ts's existing internal_link_fix
    // Action shape).
    currentValue: null,
    draftContent,
    aiDisclosure: true,
    tokenCost,
    status: decideActionStatus(guardResult.outcome, ctx.autoExecuteEnabled),
    riskTier: deriveRiskTier(guardResult.checksRun),
    guardResult,
    provenance: {
      producerKind: 'model',
      producerVersion: 'v1',
      ...findingAssociationFor(payload.findingId),
      generatorInputsSnapshot: { targetUrl: payload.targetUrl, targetTitle: payload.targetTitle, candidates: payload.candidates },
      generatorInputsVersion: 'v1',
      // Mirrors the real runProofLayer call above, including the candidate-derived approvedFacts
      // entries. Ryan's 2026-10-12 review.
      validatorInputsSnapshot: {
        sourceContent: { title: payload.targetTitle, metaDescription: null },
        aiDisclosure: true,
        recentDraftsForCustomer: [],
        approvedFacts: [...ctx.approvedFacts, ...payload.candidates.map((c) => `${c.url} ${c.title ?? ''}`)],
        restrictedWording: ctx.restrictedWording,
      },
      validatorInputsVersion: 'v1',
    },
  };
}

export async function runGenerator(payload: GenerationPayload, ctx: GenerationContext): Promise<GenerationOutcome> {
  switch (payload.actionType) {
    case 'meta_description':
      return generateMetaDescriptionOutcome(payload, ctx);
    case 'canonical_fix':
      return generateCanonicalFixOutcome(payload, ctx);
    case 'structured_data_fix':
      return generateStructuredDataFixOutcome(payload, ctx);
    case 'entity_markup_fix':
      return generateEntityMarkupFixOutcome(payload, ctx);
    case 'restricted_wording_fix':
      return generateRestrictedWordingFixOutcome(payload, ctx);
    case 'internal_link_fix':
      return generateInternalLinkFixOutcome(payload, ctx);
  }
}
