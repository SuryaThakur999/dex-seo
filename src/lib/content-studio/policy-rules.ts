import type { ContentPlatform } from '@prisma/client';
import type { RedditDraft } from './adapters/reddit';

export interface PolicyCheckResult {
  check: string;
  result: 'pass' | 'fail';
  detail: string;
}

// Structural platform requirements only — not tone/style policing. An earlier draft of this
// check also flagged ad-like phrasing ("buy now", "limited time") via regex on Reddit posts;
// cut before shipping (two-agent design review): that's the same "not every SEO issue needs a
// social post" overreach applied to tone, not in the brief's stated checks (source support,
// restricted claims, format, duplicates, policy), and would misfire on legitimate urgency or
// quoted competitor language. Only a structural requirement — every Reddit post needs a target
// community — survives.
export function checkPlatformPolicy(platform: ContentPlatform, draft: unknown): PolicyCheckResult | null {
  if (platform !== 'reddit') return null;
  const subreddits = (draft as Partial<RedditDraft>)?.suggestedSubreddits;
  if (!subreddits || subreddits.length === 0) {
    return { check: 'reddit-target-community', result: 'fail', detail: 'No subreddit suggested — a Reddit post needs a target community.' };
  }
  return { check: 'reddit-target-community', result: 'pass', detail: `Suggested subreddit(s): ${subreddits.join(', ')}.` };
}
