import type { CategoryCount } from './dashboard-stats';

// Client-safe constants and types split out of feedback-analysis.ts, which pulls in the
// `openai` SDK at module scope. feedback-patterns-card.tsx ('use client') must not import
// anything from feedback-analysis.ts as a value -- that would drag the OpenAI SDK into the
// browser bundle. feedback-analysis.ts re-exports these so its other (server-only) callers
// keep working unchanged.
export interface DecisionBreakdown {
  totals: { approved: number; rejected: number; edited: number };
  byActionType: CategoryCount[];
}

export const MIN_EDITS_FOR_SUMMARY = 5;
export const MAX_EDITS_FOR_SUMMARY = 30;
