import { isRateLimitError } from '@/lib/openai-client';

// A generation failure's real cause (provider exception text, which can name env vars like
// OPENAI_API_KEY, SDK class names, or other infra detail) must never reach a customer-facing
// surface — DEX MASTER DIRECTIVE Phase 5A: "Never expose environment-variable names, provider
// stack traces or raw exceptions to customers... Failed generation must show a friendly Retry
// state while technical details remain in protected logs." Callers still get the real error
// via console.error (server logs) — this constant is what may reach the DB column or terminal
// line a customer's browser actually renders.
export const CUSTOMER_SAFE_GENERATION_ERROR =
  "We couldn't generate this draft. Try again, or contact support if it keeps failing.";

export const CUSTOMER_SAFE_RATE_LIMIT_ERROR =
  "Dex is generating a lot of drafts right now. Try again in a minute.";

// Picks the honest message for a generation failure without ever exposing the raw error --
// same customer-facing-safety rule as above, just no longer collapsing "the provider is
// rate-limiting us" into the same generic wording as every other failure.
export function getCustomerSafeGenerationError(err: unknown): string {
  return isRateLimitError(err) ? CUSTOMER_SAFE_RATE_LIMIT_ERROR : CUSTOMER_SAFE_GENERATION_ERROR;
}
