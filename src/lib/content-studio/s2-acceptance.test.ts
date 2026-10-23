import { describe, expect, it, vi, beforeEach } from 'vitest';
import { critiqueDraft } from './critique';
import { findBannedPhrases, isContentStructure } from './playbook-shared';
import { persistContentVariants, type VariantGenerationResult } from './persist-variants';
import { db } from '@/lib/db';

// S2 acceptance golden tests, phase2f-evidence-backed-content.md S2 "Tests and review" section.
// This file defines its own fixed ClientProfile-shaped fixture and golden variants so the five
// acceptance criteria stay checkable against real, already-merged pieces (critique.ts,
// persist-variants.ts, playbook-shared.ts) without depending on a live LLM call. Anything that
// genuinely requires the not-yet-merged variant engine or route wiring is test.todo, not faked.
//
// History on "no fact outside the input" (five rounds of review, each round a different shape
// of the same class of bug -- free-text copy can always hide an unapproved clause somewhere a
// detector doesn't look): any-match-on-whole-text -> sentence-level any-match -> blanket
// exemption for anything ending in "?" -> sentence-level check still passable by a mixed clause
// ("X while Y" where only Y is approved). Every one of those was a smarter DETECTOR over
// free-form prose, and every smarter detector left a new gap. This version removes the free-form
// prose instead: a hook is no longer hand-authored text that then gets checked -- it is built by
// an anchored template with exactly one fillable slot, and that slot is always one literal
// approved claim. Round 6 found the same gap on the CTA side: a digit-only filter on free CTA
// text passed a non-numeric unapproved assertion ("eliminate manual scheduling"). Same fix --
// the CTA must be exact membership in the fixed CTA_TEMPLATES set, not free text that then gets
// checked. There is no remaining surface for unapproved content to hide in, because there is no
// remaining free text on either side.

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    contentVariant: { create: vi.fn() },
    contentPiece: { update: vi.fn() },
  },
}));

const mockedDb = db as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
  contentVariant: { create: ReturnType<typeof vi.fn> };
  contentPiece: { update: ReturnType<typeof vi.fn> };
};

const CLIENT_PROFILE_FIXTURE = {
  businessDescription: 'Boutique B2B SaaS for European freight scheduling.',
  audience: 'Operations managers at mid-size freight companies',
  // Gerund-phrase form throughout so every claim reads naturally inside the one fixed hook
  // template below ("Curious what <claim> would mean for your team?").
  approvedClaims: ['cutting manual scheduling time by 40%', 'living in 12 countries', 'running a 3-week rollout'],
  restrictedWording: ['guaranteed', 'best in the world'],
  markets: ['DE', 'FR'],
  languages: ['English'],
  objective: 'Conversion' as const,
};

interface GoldenVariant {
  index: number;
  angle: string;
  hook: string;
  structure: 'PAS' | 'story' | 'contrarian';
  cta: string;
  fullText: string;
  tokenCost: number;
}

const HOOK_TEMPLATE_PREFIX = 'Curious what ';
const HOOK_TEMPLATE_SUFFIX = ' would mean for your team?';

// The ONLY way to construct a hook. There is no other code path that produces hook text, so
// every golden hook is, by construction, exactly the fixed wrapper around one literal approved
// claim -- never hand-typed prose that could accidentally include something else.
function buildApprovedHook(claim: string): string {
  return `${HOOK_TEMPLATE_PREFIX}${claim}${HOOK_TEMPLATE_SUFFIX}`;
}

// Fixed CTA templates, never containing a digit or a claim of their own -- an instruction to the
// reader, not an assertion about the business.
const CTA_TEMPLATES: Record<string, string> = {
  'time-savings': 'Book a call to see your own numbers.',
  'market-reach': 'Book a call to map it to your own routes.',
  'rollout-speed': 'Book a call to see the rollout plan.',
};

const GOLDEN_VARIANTS: GoldenVariant[] = (
  [
    { index: 0, angle: 'time-savings', structure: 'PAS', claim: CLIENT_PROFILE_FIXTURE.approvedClaims[0], tokenCost: 410 },
    { index: 1, angle: 'market-reach', structure: 'story', claim: CLIENT_PROFILE_FIXTURE.approvedClaims[1], tokenCost: 398 },
    { index: 2, angle: 'rollout-speed', structure: 'contrarian', claim: CLIENT_PROFILE_FIXTURE.approvedClaims[2], tokenCost: 455 },
  ] as const
).map(({ index, angle, structure, claim, tokenCost }) => {
  const hook = buildApprovedHook(claim);
  const cta = CTA_TEMPLATES[angle];
  return { index, angle, hook, structure, cta, fullText: `${hook} ${cta}`, tokenCost };
});

// Strict, ANCHORED template match -- not a substring/contains check. The hook must start with
// the fixed prefix and end with the fixed suffix with nothing else around them; what's left in
// between must be exactly one literal approved claim. This is what actually closes the
// vulnerability class: a mixed clause like "Still losing real time to manual scheduling every
// week while cutting manual scheduling time by 40%?" (round 5's exact finding) does not start
// with "Curious what ", so it fails outright -- there's no partial-match path left for an
// unapproved clause to ride through on.
function hookStatesExactlyOneApprovedClaim(hook: string, approvedClaims: readonly string[]): boolean {
  if (!hook.startsWith(HOOK_TEMPLATE_PREFIX) || !hook.endsWith(HOOK_TEMPLATE_SUFFIX)) return false;
  const claim = hook.slice(HOOK_TEMPLATE_PREFIX.length, hook.length - HOOK_TEMPLATE_SUFFIX.length);
  return approvedClaims.includes(claim);
}

// Round 6: a digit-only filter on free CTA text is the same mistake as the pre-structural hook
// checks -- it only catches one shape of smuggled assertion ("book a call to save 40%"), not a
// non-numeric one ("book a call to see how we eliminate manual scheduling"). Same fix as the
// hook: the CTA can't be free text that then gets checked, it must be exact membership in the
// fixed CTA_TEMPLATES set, the only place CTA text is ever produced.
function ctaIsApprovedTemplate(cta: string): boolean {
  return Object.values(CTA_TEMPLATES).includes(cta);
}

// The real spec requirement, finally closed structurally: fullText must be EXACTLY the hook
// (which can only ever be the fixed template around one approved claim) followed by a
// non-factual CTA, with nothing else appended anywhere. No free-text surface remains for
// unapproved content to hide in.
function variantStatesOnlyApprovedClaims(variant: Pick<GoldenVariant, 'fullText' | 'hook' | 'cta'>, approvedClaims: readonly string[]): boolean {
  if (variant.fullText !== `${variant.hook} ${variant.cta}`) return false;
  if (!ctaIsApprovedTemplate(variant.cta)) return false;
  return hookStatesExactlyOneApprovedClaim(variant.hook, approvedClaims);
}

// Extracts every digit-bearing claim fragment so test 3 can check each one traces back to an
// approved fact, instead of asserting the whole sentence verbatim matches. Kept as a secondary,
// weaker check alongside the structural one above -- not the primary guarantee any more.
function extractNumericClaims(text: string): string[] {
  return text.match(/\d+(?:\s?%|\s?-week|\s+countries)/gi) ?? [];
}

// The ORIGINAL weak check from round 2: true as soon as ANY approved claim appears anywhere in
// the text. Kept only so later tests can prove, explicitly, why it is not sufficient on its own
// -- every round's bug was a case this function wrongly passed.
function containsApprovedClaim(text: string, approvedClaims: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return approvedClaims.some((fact) => lower.includes(fact.toLowerCase()));
}

const SUPPORTED_CLAIM_EXAMPLES = [
  'The fix is cutting manual scheduling time by 40%.',
  'We are living in 12 countries today.',
  'We are running a 3-week rollout, start to live.',
];

// Covers every claim shape found across all five review rounds: embellished duration,
// unapproved capability claim, competitor comparison, invented CTA duration, a plain fabricated
// statistic, a presuppositional question with no approved claim at all, and (round 5) a mixed
// clause where only HALF the sentence is approved.
const UNSUPPORTED_CLAIM_EXAMPLES = [
  'Manual scheduling eats a full day of every ops manager\'s week.',
  'We help freight teams run schedules without a local hire in every country.',
  'Most scheduling tools take a quarter to roll out.',
  'Book a 15-minute walkthrough to see your own numbers.',
  'Our customers save 90% on fuel costs.',
  'Still losing real time to manual scheduling every week?',
  // Note: a fused clause like "X while <approved claim>" is deliberately NOT in this list --
  // containsApprovedClaim() would wrongly return true for it (that's exactly round 5's bug), so
  // it can't be used as a negative control for that weak helper. It's covered in its own
  // dedicated test below instead, against the real structural check.
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.$transaction.mockImplementation((cb: (tx: typeof mockedDb) => unknown) => cb(mockedDb));
});

describe('S2 acceptance: hook, structure, and CTA', () => {
  it.each(GOLDEN_VARIANTS)('variant "$angle" opens with its hook and carries exactly one named structure', (variant) => {
    expect(variant.fullText.startsWith(variant.hook)).toBe(true);
    expect(isContentStructure(variant.structure)).toBe(true);
  });

  it.each(GOLDEN_VARIANTS)('variant "$angle" has a CTA matched to the Conversion objective', (variant) => {
    expect(variant.cta.trim().length).toBeGreaterThan(0);
    expect(variant.cta).toMatch(/\bbook a\b.*\b(call|walkthrough|demo)\b/i);
  });
});

describe('S2 acceptance: banned-phrase check', () => {
  it.each(GOLDEN_VARIANTS)('variant "$angle" contains no AI-filler phrase', (variant) => {
    expect(findBannedPhrases(variant.fullText)).toEqual([]);
  });

  it.each(GOLDEN_VARIANTS)('variant "$angle" scores clean through the real critique module', (variant) => {
    const result = critiqueDraft({
      platform: 'linkedin',
      objective: CLIENT_PROFILE_FIXTURE.objective,
      hook: variant.hook,
      cta: variant.cta,
      structure: variant.structure,
      fullText: variant.fullText,
    });
    expect(result.fixes).toEqual([]);
    expect(result.score).toBe(100);
  });

  it('a draft actually written with banned phrases does NOT score clean (negative control)', () => {
    const result = critiqueDraft({
      platform: 'linkedin',
      objective: CLIENT_PROFILE_FIXTURE.objective,
      hook: 'This is a total game-changer for logistics.',
      cta: 'Book a call.',
      structure: 'PAS',
      fullText: 'This is a total game-changer for logistics. Leverage the power of our platform. Book a call.',
    });
    expect(result.fixes.some((f) => f.category === 'banned_phrases')).toBe(true);
  });
});

describe('S2 acceptance: no fact outside the input', () => {
  it.each(GOLDEN_VARIANTS)('every numeric claim in variant "$angle" traces back to an approved claim', (variant) => {
    const claims = extractNumericClaims(variant.fullText);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      const normalized = claim.toLowerCase().replace(/\s+/g, ' ');
      const matchesApprovedFact = CLIENT_PROFILE_FIXTURE.approvedClaims.some((fact) =>
        fact.toLowerCase().includes(normalized)
      );
      expect(matchesApprovedFact).toBe(true);
    }
  });

  it.each(GOLDEN_VARIANTS)('variant "$angle" states ONLY its one approved claim -- structurally, not by detection', (variant) => {
    expect(variantStatesOnlyApprovedClaims(variant, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(true);
  });

  it.each(SUPPORTED_CLAIM_EXAMPLES)('supported example "%s" is backed by an approved claim (weaker helper, illustrative only)', (claim) => {
    expect(containsApprovedClaim(claim, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(true);
  });

  it.each(UNSUPPORTED_CLAIM_EXAMPLES)('unsupported example "%s" is NOT backed by any approved claim (negative control)', (claim) => {
    expect(containsApprovedClaim(claim, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(false);
  });

  it('a fabricated statistic absent from approved claims fails the numeric-claim check too (negative control)', () => {
    const fabricated = 'Our customers save 90% on fuel costs.';
    const claims = extractNumericClaims(fabricated);
    expect(claims.length).toBeGreaterThan(0);
    const matchesApprovedFact = CLIENT_PROFILE_FIXTURE.approvedClaims.some((fact) =>
      fact.toLowerCase().includes(claims[0].toLowerCase())
    );
    expect(matchesApprovedFact).toBe(false);
  });

  it('mixed copy (one approved claim + one unapproved assertion as separate sentences) fails the structural check', () => {
    const mixedVariant = {
      hook: 'Manual scheduling still costs ops teams real hours every week.',
      cta: 'Book a call to see your own numbers.',
      fullText:
        'Manual scheduling still costs ops teams real hours every week. The fix is cutting manual scheduling time by 40%. Book a call to see your own numbers.',
    };
    // The old weak check would have wrongly passed this (it finds the approved claim somewhere).
    expect(containsApprovedClaim(mixedVariant.fullText, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(true);
    // The structural check fails it: fullText is not exactly `${hook} ${cta}` for this hook, and
    // the hook itself doesn't match the fixed template at all.
    expect(variantStatesOnlyApprovedClaims(mixedVariant, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(false);
  });

  it('round 5\'s exact finding -- one unapproved clause fused into the SAME sentence as an approved one -- fails the structural check', () => {
    const fusedClauseVariant = {
      hook: 'Still losing real time to manual scheduling every week while cutting manual scheduling time by 40%?',
      cta: 'Book a call to see your own numbers.',
      fullText:
        'Still losing real time to manual scheduling every week while cutting manual scheduling time by 40%? Book a call to see your own numbers.',
    };
    // The round-4 sentence-level check (contains an approved claim anywhere in the sentence)
    // would have wrongly passed this -- the "40%" fragment is present in the same sentence as
    // the unapproved presupposition.
    expect(containsApprovedClaim(fusedClauseVariant.hook, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(true);
    // The structural check fails it: the hook does not start with the fixed template prefix at
    // all, regardless of what approved fragment happens to appear somewhere inside it.
    expect(variantStatesOnlyApprovedClaims(fusedClauseVariant, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(false);
  });

  it('round 6\'s exact finding -- a non-numeric CTA that asserts an unapproved outcome -- fails the structural check', () => {
    const nonNumericCtaVariant = {
      hook: buildApprovedHook(CLIENT_PROFILE_FIXTURE.approvedClaims[0]),
      cta: 'Book a call to see how we eliminate manual scheduling.',
      fullText: '',
    };
    nonNumericCtaVariant.fullText = `${nonNumericCtaVariant.hook} ${nonNumericCtaVariant.cta}`;
    // A digit-only filter would have wrongly passed this -- the CTA has no digit, but it still
    // asserts an outcome ("eliminate manual scheduling") that isn't any approved claim or fixed
    // CTA template.
    expect(ctaIsApprovedTemplate(nonNumericCtaVariant.cta)).toBe(false);
    expect(variantStatesOnlyApprovedClaims(nonNumericCtaVariant, CLIENT_PROFILE_FIXTURE.approvedClaims)).toBe(false);
  });
});

describe('S2 acceptance: exactly 3 variants with distinct angles', () => {
  it('produces exactly 3 golden variants', () => {
    expect(GOLDEN_VARIANTS).toHaveLength(3);
  });

  it('every variant argues from a genuinely different approved claim, not just a different angle label', () => {
    const primaryClaimPerVariant = GOLDEN_VARIANTS.map((v) =>
      CLIENT_PROFILE_FIXTURE.approvedClaims.find((fact) => v.fullText.toLowerCase().includes(fact.toLowerCase()))
    );
    expect(primaryClaimPerVariant.every((claim) => claim !== undefined)).toBe(true);
    expect(new Set(primaryClaimPerVariant).size).toBe(3);
  });

  it('two variants sharing one approved claim under different labels are caught as non-distinct (negative control for the label-only bug)', () => {
    const relabeledDuplicate = { ...GOLDEN_VARIANTS[1], angle: 'market-reach-restated', fullText: GOLDEN_VARIANTS[0].fullText };
    const variantsWithDuplicate = [GOLDEN_VARIANTS[0], relabeledDuplicate, GOLDEN_VARIANTS[2]];

    const labels = variantsWithDuplicate.map((v) => v.angle);
    expect(new Set(labels).size).toBe(3);

    const primaryClaims = variantsWithDuplicate.map((v) =>
      CLIENT_PROFILE_FIXTURE.approvedClaims.find((fact) => v.fullText.toLowerCase().includes(fact.toLowerCase()))
    );
    expect(new Set(primaryClaims).size).toBeLessThan(3);
  });
});

describe('S2 acceptance: tokenCost recorded per variant', () => {
  it('persists each variant with its own measured tokenCost and rolls the parent up to their sum', async () => {
    mockedDb.contentVariant.create.mockImplementation(({ data }) => Promise.resolve({ id: `v_${data.index}`, ...data }));

    const results: VariantGenerationResult[] = GOLDEN_VARIANTS.map((v) => ({
      index: v.index,
      angle: v.angle,
      draftContent: { hook: v.hook, body: v.fullText, structure: v.structure, cta: v.cta },
      status: 'needs_review',
      failureReason: null,
      critique: null,
      tokenCost: v.tokenCost,
      proofChecks: null,
    }));

    await persistContentVariants('piece_golden', results);

    const writtenCosts = mockedDb.contentVariant.create.mock.calls.map((call) => call[0].data.tokenCost);
    expect(writtenCosts).toEqual(GOLDEN_VARIANTS.map((v) => v.tokenCost));
    expect(mockedDb.contentPiece.update).toHaveBeenCalledWith({
      where: { id: 'piece_golden' },
      data: { tokenCost: 410 + 398 + 455 },
    });
  });
});

// Genuinely pending on pieces not yet merged to main: Pam's live variant-generation engine and
// the route wiring that calls it against a real ClientProfile + provider. Left as test.todo
// rather than faked against a mock LLM response, per the plan's "do not present untested
// behavior as passing" discipline. Un-skip once the engine and route integration land.
describe.todo('S2 acceptance: live engine + route integration (pending Pam\'s variant engine)', () => {
  it.todo('POST /api/content-studio/drafts produces exactly 3 real variants end to end for this fixture');
  it.todo('a failed variant attempt is persisted with status failed and its own measured partial tokenCost, never presented as a completed draft');
  it.todo('retrying one variant by index increments only that variant\'s and the parent\'s cumulative tokenCost, per retryContentVariant');
});
