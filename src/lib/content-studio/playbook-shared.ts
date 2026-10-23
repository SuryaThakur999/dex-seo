/**
 * Shared by the five S2 playbook adapters (linkedin, instagram, tiktok, youtube, reddit) only.
 * Not imported by Pam's x/facebook/ugc-brief adapters: keep it that way so the two slices
 * never collide on this file.
 */

export const CONTENT_STRUCTURES = ['PAS', 'story', 'contrarian'] as const;
export type ContentStructure = (typeof CONTENT_STRUCTURES)[number];

export function isContentStructure(value: unknown): value is ContentStructure {
  return typeof value === 'string' && (CONTENT_STRUCTURES as readonly string[]).includes(value);
}

export const STRUCTURE_PLAYBOOK = [
  'Pick exactly one structure for this draft and report it in the "structure" field:',
  '- "PAS": state the Problem the audience has, Agitate why it costs them, then the Solution.',
  '- "story": a short narrative arc ("X happened, here is what changed") that lands on the point.',
  '- "contrarian": open against a common belief or practice, then make the case for a different one.',
].join('\n');

/**
 * Static, generic AI-filler phrases, not brand-specific restricted wording (that's
 * clientProfile.restrictedWording, enforced separately). This is the S2 "banned-phrase list"
 * acceptance check: catches generic AI-slop filler regardless of client.
 */
export const AI_FILLER_PHRASES: readonly string[] = [
  'game-changer',
  'game changer',
  'unlock the power',
  'unlock your',
  'in today’s fast-paced world',
  'in today’s digital age',
  'delve into',
  'delve',
  'dive into the world of',
  'seamlessly integrate',
  'seamless integration',
  'revolutionize',
  'revolutionary',
  'cutting-edge',
  'cutting edge',
  'take it to the next level',
  'elevate your',
  'look no further',
  'at the end of the day',
  'in conclusion',
  'it’s important to note that',
  'embark on a journey',
  'navigate the landscape',
  'robust solution',
  'synergy',
  'synergize',
  'leverage the power of',
  'leverage',
];

/**
 * LinkedIn-specific pre-publish checklist rule (from the linkedin-skills content spec, folded
 * in as config/prompt material, not its Apify/Publora/Pixfaro API clients, which are out of
 * scope). An em dash is a reliable AI-writing tell at any real density; cap at roughly one per
 * 100 words.
 */
export function emDashesPerHundredWords(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return 0;
  const emDashCount = (text.match(/—/g) ?? []).length;
  return (emDashCount / wordCount) * 100;
}

export function findBannedPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return AI_FILLER_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

/**
 * Shared validation for the three S2 acceptance fields (hook, structure, CTA) plus the
 * banned-phrase check, run against the full exportable text of the draft. Each adapter calls
 * this from its own validate() and appends its own platform-specific field checks.
 */
export function validatePlaybookFields(fields: {
  hook: unknown;
  structure: unknown;
  cta: unknown;
  fullText: string;
}): string[] {
  const issues: string[] = [];
  if (typeof fields.hook !== 'string' || !fields.hook.trim()) issues.push('Missing the hook (first line).');
  if (!isContentStructure(fields.structure)) {
    issues.push(`Missing or invalid structure, must be one of: ${CONTENT_STRUCTURES.join(', ')}.`);
  }
  if (typeof fields.cta !== 'string' || !fields.cta.trim()) issues.push('Missing a CTA.');
  const banned = findBannedPhrases(fields.fullText);
  if (banned.length) issues.push(`Contains banned AI-filler phrase(s): ${banned.join(', ')}.`);
  return issues;
}
