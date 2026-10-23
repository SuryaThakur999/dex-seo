import { getOpenAIClient } from '@/lib/openai-client';
import { buildTrustedSystemPrompt, serializeUntrustedData, validatePlainTextOutput } from '@/lib/ai/untrusted-data';
import { runModelOperation } from '@/lib/ai/model-operation';

export interface DashboardInsightInput {
  pagesScanned: number;
  // Latest-scan findings count (not an all-time total) -- must match what the Work feed
  // card shows for the same scan, or the AI summary contradicts the customer's own feed
  // (e.g. "flagged none" next to a Work feed row showing 13 findings).
  pagesFlagged: number;
  guardCatchesDelta: number | null;
  pendingCount: number;
}

type OpenAICaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = 'openai/gpt-oss-120b';
const MAX_INSIGHT_LENGTH = 400;

// These four values are always server-computed real counts — never customer-entered or
// scraped text — so there's no injection surface in the input itself. Still routed through the
// shared boundary for architectural consistency and because the real risk here is the model
// inventing a cause/trend/ranking claim the numbers don't support, which the system prompt and
// output validation below both guard against.
const DASHBOARD_INSIGHT_SYSTEM_PROMPT = buildTrustedSystemPrompt([
  "You write a one-sentence summary for a website owner's SEO safety dashboard.",
  'Rules:',
  '- Base the summary ONLY on the numbers given to you. Never invent facts, numbers, or trends not present in them.',
  '- Never claim a cause, a ranking change, a traffic outcome, or a revenue impact — you were only given counts, not why they changed.',
  '- One or two short sentences, plain English, no jargon.',
  '- Output ONLY the summary text. No quotes, no preamble, no explanation.',
]);

function buildPrompt(input: DashboardInsightInput): string {
  return serializeUntrustedData('summarize_dashboard_metrics', [
    { label: 'pages_scanned_most_recent_scan', value: String(input.pagesScanned) },
    // A findings count, not a page count: one page can have several issues, so calling it
    // "pages flagged" produced summaries like "covered 4 pages and flagged 13 pages".
    { label: 'issues_found_most_recent_scan', value: String(input.pagesFlagged) },
    {
      label: 'change_vs_previous_7_days',
      value: input.guardCatchesDelta === null ? 'no prior data' : `${input.guardCatchesDelta}%`,
    },
    { label: 'drafts_waiting_for_review', value: String(input.pendingCount) },
  ]);
}

function fallbackInsight(input: DashboardInsightInput): string {
  return `${input.pagesFlagged} issues found on ${input.pagesScanned} pages in the latest scan, ${input.pendingCount} waiting for your review.`;
}

async function defaultCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: DASHBOARD_INSIGHT_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.5,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function generateDashboardInsight(
  input: DashboardInsightInput,
  callOpenAI: OpenAICaller = defaultCaller
): Promise<string> {
  // Phase 1E: bounded retry+backoff on a transient provider failure now happens inside
  // runModelOperation, above the SDK's own maxRetries:2 -- a genuinely exhausted or permanent
  // failure still falls through to the exact same real, honest fallbackInsight this already
  // had, never an invented summary.
  const result = await runModelOperation({
    operationName: 'dashboard_insight',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    execute: () => callOpenAI(buildPrompt(input)),
  });
  if (result.outcome !== 'succeeded' || !result.data) return fallbackInsight(input);
  const validated = validatePlainTextOutput(result.data.content, MAX_INSIGHT_LENGTH);
  return validated.ok ? validated.data : fallbackInsight(input);
}
