import { getOpenAIClient } from './openai-client';
import { runModelOperation } from './ai/model-operation';
import { buildTrustedSystemPrompt, serializeUntrustedData } from './ai/untrusted-data';
import { CrawledProfilePage, ProfileSuggestionProposal, validateSuggestionEvidence } from './profile-suggestion-evidence';
import { isGeographyTerm } from './geography-terms';

export const PROFILE_SUGGESTION_MODEL = 'openai/gpt-oss-120b';
export const PROFILE_SUGGESTION_PROMPT_VERSION = 'v1';

async function callModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: PROFILE_SUGGESTION_MODEL,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    temperature: 0,
  });
  return completion.choices[0]?.message?.content ?? '';
}

export async function extractProfileSuggestions(
  pages: readonly CrawledProfilePage[],
  caller: (systemPrompt: string, userPrompt: string) => Promise<string> = callModel,
): Promise<ProfileSuggestionProposal[]> {
  if (!pages.length) return [];
  const evidence = pages.slice(0, 5).map((page) => ({ url: page.url, text: page.text.slice(0, 4000) }));
  const systemPrompt = buildTrustedSystemPrompt([
    'Suggest Marketing Memory facts supported by the supplied page evidence. You cannot write, approve, or select customer ownership.',
    'Only suggest businessDescription, audience, markets, languages, or brandVoice. Never suggest claims or restricted wording.',
    'Return only a JSON array of at most 10 objects with field, value, sourceUrl, and sourceExcerpt. Return [] without supporting evidence.',
    'markets means the countries or regions a business sells into (e.g. "Germany", "DACH", "DE"), never industries, sectors, or customer types. If the page names no country or region, do not suggest markets at all.',
    'For businessDescription, audience, and brandVoice, value must be nonempty text of at most 2000 characters. For markets and languages, value must be 1 to 50 unique nonempty strings, each at most 300 characters.',
    'Each sourceUrl must exactly match a supplied source URL. Each sourceExcerpt must be a nonempty verbatim excerpt from that same supplied page. Do not infer unsupported facts.',
  ]);
  const userPrompt = serializeUntrustedData('Extract evidence-backed profile suggestions', evidence.map((page, index) => ({
    label: `page_${index + 1}`, value: page.text, sourceUrl: page.url,
  })));
  const result = await runModelOperation({
    operationName: 'profile_suggestion_extraction',
    promptVersion: PROFILE_SUGGESTION_PROMPT_VERSION,
    boundaryVersion: 'v1',
    execute: () => caller(systemPrompt, userPrompt),
  });
  if (result.outcome !== 'succeeded' || typeof result.data !== 'string' || result.data.length > 10000) {
    throw new Error('Profile suggestion extraction failed');
  }
  const proposals: unknown = JSON.parse(result.data);
  if (!Array.isArray(proposals) || proposals.length > 10) throw new Error('Invalid profile suggestions');
  return proposals
    .map((proposal) => validateSuggestionEvidence(proposal, evidence))
    .map((proposal) => (proposal.field === 'markets' ? keepOnlyGeographyValues(proposal) : proposal))
    .filter((proposal): proposal is ProfileSuggestionProposal => proposal !== null);
}

// The model is instructed to suggest countries/regions only, but instructions aren't
// deterministic -- this is the real guard against industries/sectors slipping through as
// "markets" (e.g. "freight software" instead of "Germany"). Drops the whole proposal, not just
// the bad entries, when nothing in it is a recognized country or region.
function keepOnlyGeographyValues(proposal: ProfileSuggestionProposal): ProfileSuggestionProposal | null {
  const values = (proposal.value as string[]).filter(isGeographyTerm);
  return values.length ? { ...proposal, value: values } : null;
}
