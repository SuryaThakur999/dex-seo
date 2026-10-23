// Shared claim-shaped text patterns — imported independently by proof-layer.ts (validating a
// draft about to be published, short title+meta strings, high precision needed since it gates
// publishing) and audit-agents/brand-specialist.ts (scanning the customer's own live page, full
// body text, lower stakes — it only produces a Finding for human review). Deliberately not
// re-exported from either consumer: a precision tweak for one job must not silently reshape
// what the other flags, so this lives in its own module both import from independently.
// Unicode-aware word boundaries (\p{L}/\p{N} lookaround, `u` flag) instead of plain `\b`: ASCII
// `\b` only recognizes [A-Za-z0-9_] as "word" characters, so it happily matches "best" as a
// standalone word inside the German "bestätigen" (the boundary falls right before the
// non-ASCII "ä"). Found live against real production content (a German privacy-policy page)
// during Brand Specialist verification — not a hypothetical.
export const CLAIM_PATTERNS: RegExp[] = [
  /#1(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])best(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])fastest(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])cheapest(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])top[- ]rated(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])leading(?![\p{L}\p{N}])/iu,
  /\d+%/,
  /(?<![\p{L}\p{N}])clinically proven(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])award[- ]winning(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])certified(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])guaranteed(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])voted(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])\d[\d,]*\+?\s*(customers|businesses|users|clients|companies)(?![\p{L}\p{N}])/iu,
];
