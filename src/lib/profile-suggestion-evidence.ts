import { createHash } from 'node:crypto';

export type SuggestedProfileField = 'businessDescription' | 'audience' | 'markets' | 'languages' | 'brandVoice' | 'socialProfiles';

export type SocialPlatform = 'linkedin' | 'xing' | 'instagram' | 'facebook' | 'x' | 'youtube' | 'tiktok';

export interface SocialProfile {
  platform: SocialPlatform;
  url: string;
}

export interface ProfileSuggestionProposal {
  field: SuggestedProfileField;
  value: string | string[] | SocialProfile[];
  sourceUrl: string;
  sourceExcerpt: string;
}

export interface CrawledProfilePage {
  url: string;
  text: string;
}

// S4 plan step 3: "home, about, product, and pricing pages" -- homepage matched by path, the
// rest by keyword since this codebase has no page-type taxonomy yet. False positives (e.g. a
// blog post whose slug contains "about") just mean one extra page offered as evidence, not a
// safety issue -- validateSuggestionEvidence still requires a verbatim excerpt from whatever
// page is actually sent.
const EVIDENCE_PATH_PATTERN = /\/(about|product|products|service|services|pricing|plans)(-|\/|$|[?#])/i;

export function isProfileEvidencePage(pageUrl: string, websiteUrl: string): boolean {
  try {
    const page = new URL(pageUrl);
    const site = new URL(websiteUrl);
    if (page.origin === site.origin && (page.pathname === '/' || page.pathname === '')) return true;
    return EVIDENCE_PATH_PATTERN.test(page.pathname);
  } catch {
    return false;
  }
}

// S4b (Task 27): own blog RSS and own YouTube-channel captions don't need a path/origin
// heuristic the way a full-site crawl does -- the caller already chose that specific feed or
// channel as the company's own before fetching it, so every item it returns is in-scope
// evidence by construction. A blog post's slug won't match EVIDENCE_PATH_PATTERN and a video's
// canonicalUrl is never same-origin as the website, so isProfileEvidencePage would wrongly
// reject both; these two sibling eligibility checks exist precisely to not apply that heuristic
// to a source that doesn't need it.
export function isOwnBlogRssEvidence(_itemUrl: string): boolean {
  return true;
}

export function isOwnYouTubeCaptionEvidence(_itemUrl: string): boolean {
  return true;
}

const scalarFields = ['businessDescription', 'audience', 'brandVoice'];
const arrayFields = ['markets', 'languages'];
const objectArrayFields = ['socialProfiles'];
const SOCIAL_PLATFORMS = new Set<SocialPlatform>(['linkedin', 'xing', 'instagram', 'facebook', 'x', 'youtube', 'tiktok']);
const MAX_SOCIAL_PROFILES = 20;

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isWellFormedUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// `allowEmpty`: a scan-discovered suggestion is never proposed with zero links (meaningless),
// but a direct owner edit in Settings legitimately removes the last channel -- same per-entry
// rules either way, just a different floor on list length.
export function validateSocialProfiles(value: unknown, options: { allowEmpty?: boolean } = {}): SocialProfile[] {
  const minLength = options.allowEmpty ? 0 : 1;
  if (!Array.isArray(value) || value.length < minLength || value.length > MAX_SOCIAL_PROFILES) {
    throw new Error(`Expected ${minLength}-${MAX_SOCIAL_PROFILES} social profile entries`);
  }
  const seen = new Set<string>();
  const result: SocialProfile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') throw new Error('Expected a {platform, url} entry');
    const { platform, url } = entry as Record<string, unknown>;
    if (typeof platform !== 'string' || !SOCIAL_PLATFORMS.has(platform as SocialPlatform)) {
      throw new Error('Unsupported social platform');
    }
    if (!isWellFormedUrl(url)) throw new Error('Expected a well-formed http(s) URL');
    const key = `${platform}:${url}`;
    if (seen.has(key)) throw new Error('Duplicate platform+url entry');
    seen.add(key);
    result.push({ platform: platform as SocialPlatform, url: url as string });
  }
  return result;
}

// Evidence validation establishes provenance, not approval or factual accuracy.
export function validateSuggestionEvidence(input: unknown, pages: readonly CrawledProfilePage[]): ProfileSuggestionProposal {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid suggestion');
  const { field, value, sourceUrl, sourceExcerpt } = input as Record<string, unknown>;
  if (typeof field !== 'string' || ![...scalarFields, ...arrayFields, ...objectArrayFields].includes(field)) {
    throw new Error('Unsupported profile field');
  }
  let validatedValue: string | string[] | SocialProfile[];
  if (objectArrayFields.includes(field)) {
    validatedValue = validateSocialProfiles(value);
  } else if (arrayFields.includes(field)) {
    if (!Array.isArray(value) || !value.length || value.length > 50
      || !value.every((item) => nonemptyString(item) && item.length <= 300)
      || new Set(value).size !== value.length) {
      throw new Error('Expected unique nonempty strings');
    }
    validatedValue = [...value] as string[];
  } else {
    if (!nonemptyString(value) || value.length > 2000) throw new Error('Expected nonempty text');
    validatedValue = value;
  }
  if (!nonemptyString(sourceUrl) || !nonemptyString(sourceExcerpt)
    || !pages.some((page) => page.url === sourceUrl && page.text.includes(sourceExcerpt))) {
    throw new Error('Suggestion requires a verbatim excerpt from a crawled page');
  }
  return {
    field: field as SuggestedProfileField,
    value: validatedValue,
    sourceUrl, sourceExcerpt,
  };
}

export function suggestionIdentity(input: {
  websiteId: string; clientProfileId: string; field: string; value: unknown;
  sourceUrl: string; sourceExcerpt: string; [key: string]: unknown;
}): string {
  return createHash('sha256').update(JSON.stringify([
    input.websiteId, input.clientProfileId, input.field, input.value,
    input.sourceUrl, input.sourceExcerpt,
  ])).digest('hex');
}
