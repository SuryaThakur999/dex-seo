import { createHash } from 'crypto';
import { getOpenAIClient } from '@/lib/openai-client';
import { buildTrustedSystemPrompt, serializeUntrustedData, validatePlainTextOutput } from '@/lib/ai/untrusted-data';
import { runModelOperation } from '@/lib/ai/model-operation';
import { MIN_EDITS_FOR_SUMMARY, MAX_EDITS_FOR_SUMMARY, type DecisionBreakdown } from './feedback-analysis-constants';

// Re-exported so every existing caller of this module keeps working unchanged -- the
// values themselves live in feedback-analysis-constants.ts (see that file's comment for why).
export { MIN_EDITS_FOR_SUMMARY, MAX_EDITS_FOR_SUMMARY };
export type { DecisionBreakdown };

const DECIDED_STATUSES = new Set(['approved', 'rejected', 'edited']);

// Real counts only — recomputed fresh on every page load, never cached. Pending/failed
// actions are excluded from both the totals and the breakdown; they haven't been decided yet.
export function computeDecisionBreakdown(actions: { actionType: string; status: string }[]): DecisionBreakdown {
  const decided = actions.filter((a) => DECIDED_STATUSES.has(a.status));

  const totals = { approved: 0, rejected: 0, edited: 0 };
  const byActionTypeCounts = new Map<string, number>();
  for (const action of decided) {
    if (action.status === 'approved') totals.approved += 1;
    else if (action.status === 'rejected') totals.rejected += 1;
    else if (action.status === 'edited') totals.edited += 1;
    byActionTypeCounts.set(action.actionType, (byActionTypeCounts.get(action.actionType) ?? 0) + 1);
  }

  const byActionType = Array.from(byActionTypeCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return { totals, byActionType };
}

export const PROMPT_VERSION = 'v1';
export const SUMMARY_MODEL = 'openai/gpt-oss-120b';

export interface EligibleEdit {
  auditLogEntryId: string;
  actionType: string;
  before: string;
  after: string;
  timestamp: Date;
}

interface AuditDetailShape {
  decision?: string;
  originalDraftContent?: string;
}

// An eligible edit is an action_decided entry whose decision was 'edited' and which
// captured a real originalDraftContent -- the exact shape the edit route
// (src/app/api/actions/[actionId]/edit/route.ts) always writes. Newest first, capped at
// MAX_EDITS_FOR_SUMMARY so a mature account's full history never blows up prompt size/cost.
export function extractEligibleEdits(
  auditEntries: { id: string; actionId: string | null; detail: unknown; createdAt: Date }[],
  actionsById: Map<string, { actionType: string; draftContent: string }>
): EligibleEdit[] {
  // Dedupe by actionId first, keeping only the newest entry per action. The revert route
  // (src/app/api/actions/[actionId]/revert/route.ts) puts an edited action back to 'pending'
  // without removing its original 'action_decided' audit entry, so an edit -> revert ->
  // edit-again cycle leaves two eligible entries tied to what is now a single action. Without
  // this step that action would be double-counted as two eligible edits.
  const newestByActionId = new Map<string, { id: string; actionId: string; detail: AuditDetailShape; createdAt: Date }>();
  for (const entry of auditEntries) {
    const detail = entry.detail as AuditDetailShape | null;
    if (!entry.actionId || detail?.decision !== 'edited' || !detail.originalDraftContent) continue;
    const existing = newestByActionId.get(entry.actionId);
    if (!existing || entry.createdAt.getTime() > existing.createdAt.getTime()) {
      newestByActionId.set(entry.actionId, { id: entry.id, actionId: entry.actionId, detail, createdAt: entry.createdAt });
    }
  }

  const eligible: EligibleEdit[] = [];
  for (const entry of newestByActionId.values()) {
    const action = actionsById.get(entry.actionId);
    if (!action) continue;
    eligible.push({
      auditLogEntryId: entry.id,
      actionType: action.actionType,
      before: entry.detail.originalDraftContent!,
      after: action.draftContent,
      timestamp: entry.createdAt,
    });
  }
  return eligible.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, MAX_EDITS_FOR_SUMMARY);
}

// The staleness signal: a sha256 of the sorted source AuditLogEntry IDs. Any new eligible
// edit (or a different set entering the MAX_EDITS_FOR_SUMMARY window) changes the hash.
export function computeSourceFingerprint(edits: EligibleEdit[]): string {
  const ids = edits.map((e) => e.auditLogEntryId).sort();
  return createHash('sha256').update(ids.join(',')).digest('hex');
}

// Trusted, fixed application code — never interpolates edit content. The model may only
// analyze the evidence in the next (untrusted) message; it never activates a preference itself
// (see preference-candidates.ts's deterministic gate for what actually decides that).
const FEEDBACK_SUMMARY_SYSTEM_PROMPT = buildTrustedSystemPrompt([
  'You analyze how a website owner edits AI-generated draft changes before approving them.',
  'Rules:',
  '- Base your analysis ONLY on the edits given to you. Never invent facts, patterns, or edits not present in them.',
  "- If you don't see a clear recurring pattern across multiple edits, say so honestly instead of forcing one.",
  '- Two or three short sentences, plain English, no jargon.',
  '- Output ONLY the analysis text. No quotes, no preamble, no explanation.',
  '- This is analysis only. You cannot activate, promote, or apply any preference — that decision is made by separate deterministic code, never by you.',
]);

export function buildFeedbackSummaryPrompt(edits: EligibleEdit[]): string {
  return serializeUntrustedData(
    'analyze_recurring_edit_pattern',
    edits.map((e) => ({
      label: `edit_${e.auditLogEntryId}`,
      value: `Action type: ${e.actionType} | Decision: edited | Timestamp: ${e.timestamp.toISOString()}\nBefore: ${e.before}\nAfter: ${e.after}`,
    }))
  );
}

type SummaryCaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

async function defaultSummaryCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: SUMMARY_MODEL,
    messages: [
      { role: 'system', content: FEEDBACK_SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.5,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

const FALLBACK_MESSAGE = "Dex couldn't generate a pattern summary this time. Your edit counts above are still accurate.";
const MAX_SUMMARY_LENGTH = 1000;

export async function generateFeedbackSummary(edits: EligibleEdit[], callOpenAI: SummaryCaller = defaultSummaryCaller): Promise<string> {
  // Phase 1E: bounded retry+backoff on a transient provider failure now happens inside
  // runModelOperation, above the SDK's own maxRetries:2 -- an exhausted or permanent failure
  // still falls through to the exact same honest FALLBACK_MESSAGE this already had.
  const result = await runModelOperation({
    operationName: 'feedback_pattern_summary',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    execute: () => callOpenAI(buildFeedbackSummaryPrompt(edits)),
  });
  if (result.outcome !== 'succeeded' || !result.data) return FALLBACK_MESSAGE;
  const validated = validatePlainTextOutput(result.data.content, MAX_SUMMARY_LENGTH);
  return validated.ok ? validated.data : FALLBACK_MESSAGE;
}
