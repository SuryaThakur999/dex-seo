import type { ContentPlatform } from '@prisma/client';
import { runProofLayer, type ProofLayerResult } from '@/lib/proof-layer';
import { checkPlatformPolicy } from './policy-rules';

export interface ContentProofInput {
  platform: ContentPlatform;
  // adapter.formatExport(draft) output — the plain text a human actually copies and posts.
  draftText: string;
  // The typed draft object itself (e.g. RedditDraft), for platform-policy checks that need a
  // structured field (suggestedSubreddits) rather than just the formatted text.
  rawDraft: unknown;
  approvedFacts: string[];
  restrictedWording: string[];
  // Recent same-platform ContentPieces for this client, already run through formatExport.
  recentDraftTexts: string[];
}

// Content-Studio-specific wrapper around the shared runProofLayer: same core checks
// (disclosure, unverifiable claims, contradiction, length, duplicates, restricted wording), plus
// a platform-specific structural check (policy-rules.ts) layered on top.
export function runContentProofLayer(input: ContentProofInput): ProofLayerResult {
  const base = runProofLayer({
    draftContent: input.draftText,
    // Content Studio drafts have no scanned source page — a freeform topic, or at most an
    // Action's pageUrl/actionType/draftContent (no title/metaDescription). Stated explicitly as
    // always-null rather than fabricating source content that doesn't exist: this means
    // checkUnverifiableClaims/checkContradiction check only against approvedFacts here, not
    // against page content, for this path.
    sourceContent: { title: null, metaDescription: null },
    // Matches the existing meta_description path's precedent (run-scan.ts) rather than
    // inventing a second disclosure convention — Dex-generated content is always AI-disclosed.
    aiDisclosure: true,
    recentDraftsForCustomer: input.recentDraftTexts,
    approvedFacts: input.approvedFacts,
    restrictedWording: input.restrictedWording,
  });

  const policy = checkPlatformPolicy(input.platform, input.rawDraft);
  if (!policy) return base;

  const checksRun = [...base.checksRun, policy];
  if (policy.result === 'pass') return { ...base, checksRun };

  // A structural policy failure is worth a human look but never downgrades an existing hard
  // block — only ever upgrades a clean pass to a flag.
  const outcome = base.outcome === 'block' ? 'block' : 'flag';
  const reasoning = base.outcome === 'pass' ? policy.detail : `${base.reasoning} ${policy.detail}`;
  return { outcome, checksRun, reasoning };
}
