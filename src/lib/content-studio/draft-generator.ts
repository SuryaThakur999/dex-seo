import { getOpenAIClient } from '@/lib/openai-client';
import { buildTrustedSystemPrompt, serializeUntrustedData, validatePlainTextOutput } from '@/lib/ai/untrusted-data';
import { runModelOperation } from '@/lib/ai/model-operation';
import { buildGroundingBlock, type DraftPromptInput, type PlatformAdapter } from './adapter-types';
import { ContentGenerationError } from './generation-error';
import { getVariantAngle, type VariantAngleIndex } from './variant-angles';
import { buildRevisionPrompt, type ReviseDraftInput } from './revise';

export interface ContentDraftResult<TDraft> {
  draft: TDraft;
  tokenCost: number;
}

type OpenAICaller = (systemPrompt: string, userPrompt: string) => Promise<{ content: string; totalTokens: number }>;

const MODEL = 'openai/gpt-oss-120b';
// Generous above the largest single adapter field cap (Facebook's 63206-char body) since this
// bounds the whole raw response (which may include a YouTube script plus title plus
// description, or a full structured payload) before per-adapter parsing and field-level
// validation run.
const MAX_RAW_DRAFT_LENGTH = 100_000;

async function defaultCaller(systemPrompt: string, userPrompt: string): Promise<{ content: string; totalTokens: number }> {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  const totalTokens = completion.usage?.total_tokens ?? 0;
  return { content, totalTokens };
}

export async function generateContentDraft<TDraft>(
  adapter: PlatformAdapter<TDraft>,
  input: DraftPromptInput,
  callOpenAI: OpenAICaller = defaultCaller,
  angleIndex?: VariantAngleIndex,
  revision?: ReviseDraftInput,
): Promise<ContentDraftResult<TDraft>> {
  // Fixed platform and angle instructions are trusted. Everything
  // per-request (topic, audience, objective, sourceAction) goes through buildGroundingBlock's
  // untrusted-data envelope as the user message, never spliced into the system prompt.
  const instructions = [adapter.buildInstructions()];
  if (angleIndex !== undefined) instructions.push(getVariantAngle(angleIndex).instruction);
  if (revision) instructions.push('Revise the supplied draft using its critique, retaining the required platform output format and grounding rules. Never add unsupported facts to satisfy a critique.');
  const systemPrompt = buildTrustedSystemPrompt(instructions);
  let userPrompt = buildGroundingBlock(input);
  if (revision) {
    const text = buildRevisionPrompt(revision);
    const sources = [];
    for (let offset = 0; offset < text.length; offset += 4000) {
      sources.push({ label: `revision part ${sources.length + 1}`, value: text.slice(offset, offset + 4000) });
    }
    userPrompt += '\n' + serializeUntrustedData('Draft revision', sources);
  }

  // Phase 1E: bounded retry+backoff on a transient provider failure now happens inside
  // runModelOperation, above the SDK's own maxRetries:2. A Content Studio draft is real
  // customer-facing content a human will review and publish -- like creation-engine.ts's meta
  // descriptions, and unlike dashboard-insight's soft summary, a failure here throws rather than
  // fabricating placeholder copy, so every existing caller's real failure UX still applies.
  const result = await runModelOperation({
    operationName: 'content_studio_draft',
    promptVersion: 'v1',
    boundaryVersion: 'v1',
    execute: () => callOpenAI(systemPrompt, userPrompt),
  });
  if (result.outcome !== 'succeeded' || !result.data) {
    throw new Error(`Draft for ${adapter.platform} (topic: ${input.topic}) failed: ${result.safeErrorClass ?? 'unknown error'}`);
  }
  const { content, totalTokens } = result.data;

  // A generous whole-response bound before parsing -- catches "empty" and "wildly oversized"
  // (e.g. a runaway or garbled response) cheaply. Each adapter's own `validate()` (called by its
  // caller after `parseModelOutput` below) is the real per-field structural check (body/title
  // character caps, hashtag counts, etc.). This bounds raw input before parsing.
  const validated = validatePlainTextOutput(content, MAX_RAW_DRAFT_LENGTH);
  if (!validated.ok) {
    throw new ContentGenerationError(`Draft for ${adapter.platform} (topic: ${input.topic}) failed validation: ${validated.error}`, totalTokens);
  }
  try {
    const draft = adapter.parseModelOutput(validated.data);
    return { draft, tokenCost: totalTokens };
  } catch (cause) {
    throw new ContentGenerationError(`Draft for ${adapter.platform} failed parsing`, totalTokens, cause);
  }
}
