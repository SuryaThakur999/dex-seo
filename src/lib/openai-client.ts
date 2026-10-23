import OpenAI, { RateLimitError, InternalServerError, APIConnectionError } from 'openai';

/**
 * Single shared factory for every OpenAI-backed generation call in this codebase
 * (creation-engine, feedback-analysis, preference-candidates, draft-generator,
 * dashboard-insight each had their own byte-identical `new OpenAI({...})` before this).
 * `maxRetries: 2` lets the SDK's own built-in backoff — which already reads a 429
 * response's `Retry-After` header — get one extra attempt before falling through to the
 * job-level retry Phase 1C's GenerationJob queue now provides
 * (docs/superpowers/specs/2026-09-28-phase1c-generation-queue-adr.md).
 */
export function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    timeout: 15_000,
    maxRetries: 2,
  });
}

// Single provider+model this codebase calls today (Groq, via the baseURL override above,
// per ADR 0006) — centralized here because Phase 1C's ProviderCircuitBreaker keys on this
// exact pair, so every generator's own MODEL constant must be the same value, not an
// independently-maintained duplicate that could drift out of sync with the breaker's key.
export const GENERATION_PROVIDER = 'groq';
export const GENERATION_MODEL = 'openai/gpt-oss-120b';

export function isRateLimitError(err: unknown): boolean {
  return err instanceof RateLimitError;
}

// A 429's own Retry-After header (seconds) is the authoritative wait time when the provider
// supplies one — only falls back to a fixed value when it doesn't.
export function getRetryAfterMs(err: unknown): number | null {
  if (!(err instanceof RateLimitError)) return null;
  const raw = err.headers?.['retry-after'];
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

// Phase 1E: the general transient-vs-permanent classification every retry layer in this
// codebase (Phase 1C's generation-worker.ts, Phase 1E's model-operation.ts) shares, so a new
// caller can't silently retry something that will never succeed (a 4xx auth/validation error)
// or give up on something that genuinely might (a rate limit, a 5xx, a dropped connection).
// `APIConnectionTimeoutError` extends `APIConnectionError`, so this covers both a hard
// connection failure and a request that timed out waiting for one.
export function isRetryableProviderError(err: unknown): boolean {
  return err instanceof RateLimitError || err instanceof InternalServerError || err instanceof APIConnectionError;
}
