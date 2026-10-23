import type { ProofOutcome } from '@prisma/client';
import { CLAIM_PATTERNS } from '@/lib/claim-patterns';

export interface ProofCheckResult {
  check: string;
  result: 'pass' | 'fail';
  detail: string;
}

export interface ProofLayerInput {
  draftContent: string;
  sourceContent: { title: string | null; metaDescription: string | null };
  aiDisclosure: boolean;
  recentDraftsForCustomer: string[];
  approvedFacts: string[];
  // Optional so existing callers that predate this check keep working unchanged — an omitted
  // or empty list simply means nothing to check against, not a pass-by-default judgment call.
  restrictedWording?: string[];
}

export interface ProofLayerResult {
  outcome: ProofOutcome;
  checksRun: ProofCheckResult[];
  reasoning: string;
}

const MAX_LENGTH = 155;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;
const HARD_FAIL_CHECKS = new Set(['ai-content-disclosure', 'no-unverifiable-claims', 'no-contradiction', 'no-restricted-wording']);

function sourceText(source: { title: string | null; metaDescription: string | null }): string {
  return `${source.title ?? ''} ${source.metaDescription ?? ''}`.toLowerCase();
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function checkDisclosure(aiDisclosure: boolean): ProofCheckResult {
  return aiDisclosure
    ? { check: 'ai-content-disclosure', result: 'pass', detail: 'Disclosure flag attached.' }
    : { check: 'ai-content-disclosure', result: 'fail', detail: 'AI-content disclosure flag is missing.' };
}

function checkUnverifiableClaims(
  draftContent: string,
  source: { title: string | null; metaDescription: string | null },
  approvedFacts: string[]
): ProofCheckResult {
  const rawHaystack = `${sourceText(source)} ${approvedFacts.join(' ').toLowerCase()}`;
  const normalizedHaystack = normalizeForComparison(rawHaystack);

  for (const pattern of CLAIM_PATTERNS) {
    const match = draftContent.match(pattern);
    if (!match) continue;

    const normalizedMatch = normalizeForComparison(match[0]);
    // Short/symbol-only matches (e.g. "#1", "43%") lose their specificity once
    // stripped of punctuation — comparing them raw avoids false "pass" matches
    // against unrelated numbers elsewhere in the source (e.g. a year like "2019").
    const isSpecificEnough = normalizedMatch.length >= 4;
    const found = isSpecificEnough
      ? normalizedHaystack.includes(normalizedMatch)
      : rawHaystack.toLowerCase().includes(match[0].toLowerCase());

    if (!found) {
      return {
        check: 'no-unverifiable-claims',
        result: 'fail',
        detail: `Draft contains "${match[0]}", which does not appear in the source page content.`,
      };
    }
  }
  return { check: 'no-unverifiable-claims', result: 'pass', detail: 'No unverifiable numeric or superlative claims found.' };
}

function checkContradiction(
  draftContent: string,
  source: { title: string | null; metaDescription: string | null },
  approvedFacts: string[]
): ProofCheckResult {
  const haystack = `${sourceText(source)} ${approvedFacts.join(' ').toLowerCase()}`;
  const draftLower = draftContent.toLowerCase();
  if (haystack.includes('out of stock') && draftLower.includes('in stock')) {
    return {
      check: 'no-contradiction',
      result: 'fail',
      detail: 'Draft claims the product is in stock, but the source page says it is out of stock.',
    };
  }
  return { check: 'no-contradiction', result: 'pass', detail: 'Draft does not contradict the source page content.' };
}

// ClientProfile.restrictedWording is fetched and put into the generation prompt (see
// content-studio/adapter-types.ts's buildGroundingBlock) but was never independently verified
// against what the model actually produced — anywhere in the codebase, for either the
// meta_description path or Content Studio. This closes that gap: a real, deterministic
// post-generation check, not reliance on the model having followed the prompt's instruction.
function checkRestrictedWording(draftContent: string, restrictedWording: string[]): ProofCheckResult {
  const lowerDraft = draftContent.toLowerCase();
  const hit = restrictedWording.find((term) => term.trim() && lowerDraft.includes(term.trim().toLowerCase()));
  return hit
    ? { check: 'no-restricted-wording', result: 'fail', detail: `Draft contains restricted wording: "${hit}".` }
    : { check: 'no-restricted-wording', result: 'pass', detail: 'No restricted wording found.' };
}

function checkLength(draftContent: string): ProofCheckResult {
  const length = draftContent.trim().length;
  return length > MAX_LENGTH
    ? { check: 'length-format', result: 'fail', detail: `Draft is ${length} characters, over the ${MAX_LENGTH}-character guidance.` }
    : { check: 'length-format', result: 'pass', detail: `Draft is ${length} characters, within range.` };
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

function checkDuplicateRisk(draftContent: string, recentDraftsForCustomer: string[]): ProofCheckResult {
  for (const existing of recentDraftsForCustomer) {
    if (jaccardSimilarity(draftContent, existing) >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return {
        check: 'duplicate-risk',
        result: 'fail',
        detail: 'Draft is a near-duplicate of another recent draft for this customer.',
      };
    }
  }
  return { check: 'duplicate-risk', result: 'pass', detail: 'No near-duplicate found among recent drafts for this customer.' };
}

export function runProofLayer(input: ProofLayerInput): ProofLayerResult {
  const checksRun: ProofCheckResult[] = [
    checkDisclosure(input.aiDisclosure),
    checkUnverifiableClaims(input.draftContent, input.sourceContent, input.approvedFacts),
    checkContradiction(input.draftContent, input.sourceContent, input.approvedFacts),
    checkLength(input.draftContent),
    checkDuplicateRisk(input.draftContent, input.recentDraftsForCustomer),
    checkRestrictedWording(input.draftContent, input.restrictedWording ?? []),
  ];

  const failedChecks = checksRun.filter((c) => c.result === 'fail');
  const hardFail = failedChecks.find((c) => HARD_FAIL_CHECKS.has(c.check));

  if (hardFail) {
    return { outcome: 'block', checksRun, reasoning: failedChecks.map((c) => c.detail).join(' ') };
  }
  if (failedChecks.length > 0) {
    return { outcome: 'flag', checksRun, reasoning: failedChecks.map((c) => c.detail).join(' ') };
  }
  return { outcome: 'pass', checksRun, reasoning: 'All checks passed.' };
}

export function decideActionStatus(outcome: ProofOutcome, autoExecuteEnabled: boolean): 'approved' | 'pending' {
  return outcome === 'pass' && autoExecuteEnabled ? 'approved' : 'pending';
}

// A hard fail on disclosure or contradiction is a factual/compliance risk (high);
// an unverifiable claim alone is medium; anything else (a soft flag like length or
// duplicate-risk, or a clean pass) is low. Never user-set — derived purely from
// which checks actually failed, so it can't be gamed by a customer's own settings.
export function deriveRiskTier(checksRun: ProofCheckResult[]): 'low' | 'medium' | 'high' {
  const failed = new Set(checksRun.filter((c) => c.result === 'fail').map((c) => c.check));
  if (failed.has('ai-content-disclosure') || failed.has('no-contradiction')) return 'high';
  if (failed.has('no-unverifiable-claims')) return 'medium';
  return 'low';
}
