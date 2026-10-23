// Phase 1E, Part E #2: a static contract for every real model operation in this codebase.
// `operation-registry.test.ts` cross-checks this list against the actual call sites (Part A's
// verified inventory) and asserts `toolsAllowed` is false everywhere -- this product gives
// models no tool-calling or publishing surface today, and this registry is what a future PR
// adding one would have to consciously edit, not silently bypass.
//
// promptVersion/boundaryVersion are bumped by hand whenever that operation's system prompt or
// the shared boundary module's envelope shape changes meaningfully -- they exist so a stored
// GenerationJob/log line can be traced back to the exact contract that produced it, per the
// Phase 1E directive's Part D observability requirement.

export interface ModelOperationDefinition {
  operationName: string;
  promptVersion: string;
  boundaryVersion: string;
  // What kind of untrusted material this operation's user message carries -- documentation of
  // the real risk shape, not an enforced runtime type.
  inputClassification: 'crawled_page_content' | 'customer_edit_history' | 'server_computed_metrics';
  outputValidator: 'plainText' | 'json';
  maxInputChars: number;
  maxOutputChars: number;
  toolsAllowed: false;
}

export const MODEL_OPERATIONS: readonly ModelOperationDefinition[] = [
  {
    operationName: 'meta_description',
    promptVersion: 'v2', // v2 = migrated onto the shared untrusted-data boundary (Phase 1E)
    boundaryVersion: 'v1',
    inputClassification: 'crawled_page_content',
    outputValidator: 'plainText',
    maxInputChars: 4000, // untrusted-data.ts's own per-field truncation bound
    maxOutputChars: 400,
    toolsAllowed: false,
  },
  {
    operationName: 'restricted_wording_fix',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    inputClassification: 'crawled_page_content',
    outputValidator: 'plainText',
    maxInputChars: 4000,
    // Scales with match count in the real code (Math.max(400, matches.length * 400)) -- this is
    // the single-match floor, not a hard ceiling on every call.
    maxOutputChars: 400,
    toolsAllowed: false,
  },
  {
    operationName: 'internal_link_fix',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    inputClassification: 'crawled_page_content',
    outputValidator: 'plainText',
    maxInputChars: 4000,
    maxOutputChars: 900, // MAX_SUGGESTIONS (3) * 300
    toolsAllowed: false,
  },
  {
    operationName: 'content_studio_draft',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    inputClassification: 'crawled_page_content',
    outputValidator: 'plainText',
    maxInputChars: 4000,
    maxOutputChars: 100_000,
    toolsAllowed: false,
  },
  {
    operationName: 'feedback_pattern_summary',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    inputClassification: 'customer_edit_history',
    outputValidator: 'plainText',
    maxInputChars: 4000,
    maxOutputChars: 1000,
    toolsAllowed: false,
  },
  {
    operationName: 'preference_candidate_proposal',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    inputClassification: 'customer_edit_history',
    outputValidator: 'json',
    maxInputChars: 4000,
    maxOutputChars: 2000,
    toolsAllowed: false,
  },
  {
    operationName: 'dashboard_insight',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    inputClassification: 'server_computed_metrics',
    outputValidator: 'plainText',
    maxInputChars: 4000,
    maxOutputChars: 400,
    toolsAllowed: false,
  },
  {
    operationName: 'profile_suggestion_extraction',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    inputClassification: 'crawled_page_content',
    outputValidator: 'json',
    maxInputChars: 4000,
    maxOutputChars: 10000,
    toolsAllowed: false,
  },
];
