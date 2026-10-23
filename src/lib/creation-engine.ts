import { getOpenAIClient, GENERATION_MODEL } from '@/lib/openai-client';
import { buildTrustedSystemPrompt, serializeUntrustedData, validatePlainTextOutput } from '@/lib/ai/untrusted-data';

export interface PageContentForDraft {
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
}

export interface DraftResult {
  draftContent: string;
  tokenCost: number;
}

type OpenAICaller = (prompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = GENERATION_MODEL;
// A real meta description is comfortably under 200 chars; this just bounds a pathological
// response (the model ignoring the 120-155 instruction entirely) before it reaches ProofLayer.
const MAX_DRAFT_LENGTH = 400;

// Phase 1E (docs/superpowers -- the Phase 1E completion directive): moved onto the shared
// untrusted-data boundary (src/lib/ai/untrusted-data.ts). Page title/metaDescription/h1/url are
// scraped from a real, sometimes-external web page -- untrusted content, not instructions.
// Previously this file fenced that content inline with an ad-hoc "treat as data" instruction;
// now it uses the same JSON-envelope serialization every other real generation path in this
// codebase already uses, which additionally survives a page whose content contains something
// that looks like a closing delimiter (JSON.stringify escapes it; a hand-rolled "--- END ---"
// marker doesn't). This doesn't replace ProofLayer's downstream hard-fail checks
// (no-unverifiable-claims, no-restricted-wording, no-contradiction already catch most real
// damage) -- it's the input-side layer, not a claim of being injection-proof on its own.
const META_DESCRIPTION_SYSTEM_PROMPT = buildTrustedSystemPrompt([
  "You write SEO meta descriptions for a customer's website.",
  'Rules:',
  '- Base the description ONLY on the page content given below. Never invent facts, numbers, or claims not present in it.',
  '- Length: 120-155 characters.',
  '- Sound like a person wrote it, not keyword-stuffed.',
  '- Output ONLY the meta description text. No quotes, no preamble, no explanation.',
]);

function buildPrompt(page: PageContentForDraft): string {
  return serializeUntrustedData('draft_meta_description', [
    { label: 'page_url', value: page.url },
    { label: 'page_title', value: page.title ?? '(none found)' },
    { label: 'current_meta_description', value: page.metaDescription ?? '(none found)' },
    { label: 'main_heading_h1', value: page.h1 ?? '(none found)' },
  ]);
}

async function defaultCaller(prompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: META_DESCRIPTION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function draftMetaDescription(
  page: PageContentForDraft,
  callOpenAI: OpenAICaller = defaultCaller
): Promise<DraftResult> {
  const prompt = buildPrompt(page);
  const { content, totalTokens } = await callOpenAI(prompt);
  // A validation failure throws rather than falling back to invented copy -- unlike
  // dashboard-insight.ts's soft summary or feedback-analysis.ts's pattern note, a meta
  // description is real customer-facing content a human will approve and publish. Every
  // existing caller (run-scan.ts, retry-draft/route.ts, generation-dispatch.ts) already treats
  // a thrown error here as a real generation failure -- same customer-safe "Draft failed, retry"
  // path a provider outage would have produced before this change, not a new failure mode.
  const validated = validatePlainTextOutput(content, MAX_DRAFT_LENGTH);
  if (!validated.ok) {
    throw new Error(`Meta-description draft for ${page.url} failed validation: ${validated.error}`);
  }
  return { draftContent: validated.data, tokenCost: totalTokens };
}
