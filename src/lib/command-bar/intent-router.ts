/**
 * Deterministic intent router for the command bar. Pattern-matching only,
 * no LLM in this path, no dynamic dispatch, no user text ever reaches a
 * shell, SQL string, or arbitrary tool call. The route handler that consumes
 * this switches on `.type` against a fixed, explicit set of allowlisted
 * server actions; a `CommandBarIntent` value is inert data, not a command.
 *
 * Scope: audits, pending drafts, outcomes, scan reports, oldest pending
 * change evidence, items needing attention, and Content Studio navigation.
 * Specific-finding selection remains deferred; evidence has no selected-item
 * context. Content requests navigate only, never generate.
 */

import type { ContentPlatform } from '@prisma/client';

export type CommandBarIntent =
  | { type: 'run_audit'; pastedUrl: string | null }
  | { type: 'list_pending' }
  | { type: 'list_outcomes' }
  | { type: 'scan_report' }
  | { type: 'show_evidence' }
  | { type: 'list_blocked' }
  | { type: 'request_content'; platform: ContentPlatform | null; topic: string | null }
  | { type: 'help' };

const AUDIT_KEYWORDS = /\b(audit|scan|check|crawl)\b/i;
const SCAN_REPORT_KEYWORDS = /\b(scan (report|log|status)|(?:last|latest) scan)\b/i;
const EVIDENCE_KEYWORDS = /\b(evidence|explain)\b/i;
const BLOCKED_KEYWORDS = /\b(blocked|flagged|stuck)\b/i;
const PENDING_KEYWORDS = /\b(pending|needs?\s+(review|attention)|drafts?|queue)\b/i;
const OUTCOMES_KEYWORDS = /\b(outcomes?|results?|measured|what happened|performance)\b/i;
// Bare-domain match (example.com/path) or a full http(s) URL — either way we
// only ever use this to compare against the workspace's own connected site,
// never to fetch or execute anything from the string itself.
const URL_PATTERN = /(https?:\/\/\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;

const CONTENT_KEYWORDS = /\b(draft|write|create)\b/i;
const PLATFORM_PATTERNS: [RegExp, ContentPlatform][] = [
  [/\blinkedin\b/i, 'linkedin'],
  [/\binstagram\b/i, 'instagram'],
  [/\bfacebook\b/i, 'facebook'],
  // A bare "x" is too common a letter to claim as a platform name — it would
  // shadow phrasing like "write up what happened with x", which is an
  // outcomes question. Only match X when the surrounding words make the
  // platform reading unambiguous.
  [/\btwitter\b|\bx\.com\b|\b(?:on|for|to)\s+x\b|\bx\s+(?:post|posts|thread|threads|reply|replies)\b/i, 'x'],
  [/\breddit\b/i, 'reddit'],
  [/\btiktok\b/i, 'tiktok'],
  [/\byoutube\b/i, 'youtube'],
  [/\b(ugc|creator brief)\b/i, 'ugc_brief'],
];
const TOPIC_PATTERN = /\babout\s+(.+)$/i;

export function parseCommandBarIntent(rawInput: string): CommandBarIntent {
  const text = rawInput.trim();
  if (!text) return { type: 'help' };

  const urlMatch = text.match(URL_PATTERN);
  if (urlMatch) {
    return { type: 'run_audit', pastedUrl: urlMatch[0] };
  }
  if (SCAN_REPORT_KEYWORDS.test(text)) return { type: 'scan_report' };
  if (AUDIT_KEYWORDS.test(text)) return { type: 'run_audit', pastedUrl: null };

  if (CONTENT_KEYWORDS.test(text)) {
    const platformMatch = PLATFORM_PATTERNS.find(([pattern]) => pattern.test(text));
    if (platformMatch) {
      const topicMatch = text.match(TOPIC_PATTERN);
      return { type: 'request_content', platform: platformMatch[1], topic: topicMatch ? topicMatch[1].trim() : null };
    }
  }

  if (EVIDENCE_KEYWORDS.test(text)) return { type: 'show_evidence' };
  if (BLOCKED_KEYWORDS.test(text)) return { type: 'list_blocked' };
  if (PENDING_KEYWORDS.test(text)) return { type: 'list_pending' };
  if (OUTCOMES_KEYWORDS.test(text)) return { type: 'list_outcomes' };
  return { type: 'help' };
}
