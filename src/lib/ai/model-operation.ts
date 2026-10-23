import { randomUUID } from 'node:crypto';
import { isRetryableProviderError, getRetryAfterMs } from '@/lib/openai-client';
import { getCustomerSafeGenerationError } from '@/lib/customer-safe-error';

// Phase 1E (the Phase 1E completion directive, Part D): a request-scoped retry and
// observability wrapper for the real model-call paths Phase 1C's durable GenerationJob queue
// deliberately does NOT cover -- Content Studio's draft-generator, feedback-analysis,
// preference-candidates, and dashboard-insight (see
// docs/superpowers/specs/2026-09-28-phase1c-generation-queue-adr.md's scope section: those four
// are named out of scope on purpose). Those four are synchronous, single-request, user-facing
// calls with only the OpenAI SDK's own `maxRetries: 2` behind them and no bounded retry above
// that, no structured outcome for monitoring, and no per-request idempotency guard against
// double-submitting the same call within one retry loop.
//
// This gives them real bounded retry with Retry-After-aware, jittered backoff and a typed
// result -- without giving them Phase 1C's persisted job table, cross-invocation idempotency
// key, or shared circuit breaker. Those solve a *background job* durability problem (a process
// can die between "provider call succeeded" and "result persisted," and a later sweep needs to
// pick the work back up) that a single in-flight HTTP request simply doesn't have. Deliberately
// NOT wired into Phase 1C's own call sites (run-scan.ts, retry-draft, generation-dispatch.ts) --
// generation-worker.ts's own retry/breaker machinery already covers those, and layering this
// wrapper around a durable job's own attempt would double-retry and double-count.

export type ModelOperationOutcome = 'succeeded' | 'failed_safe';

export interface ModelOperationResult<T> {
  outcome: ModelOperationOutcome;
  data: T | null;
  operationId: string;
  operationName: string;
  promptVersion: string;
  boundaryVersion: string;
  attempts: number;
  durationMs: number;
  // Non-null only on `failed_safe` -- the same customer-safe string this codebase's Action rows
  // already use (getCustomerSafeGenerationError), never a raw provider exception.
  safeErrorClass: string | null;
  timestamp: string;
}

export interface ModelOperationOptions<T> {
  operationName: string;
  promptVersion: string;
  boundaryVersion: string;
  maxAttempts?: number;
  execute: () => Promise<T>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
// Base backoff before a retry, doubled per attempt (attempt 1->2: ~500ms, 2->3: ~1000ms),
// jittered +/-30% so concurrent requests hitting the same transient provider blip don't all
// retry in lockstep against it.
const BASE_BACKOFF_MS = 500;
// A provider's own Retry-After header is honored up to this cap, not unconditionally --
// unlike Phase 1C's generation-worker.ts (which persists nextRetryAt and returns immediately,
// safe to honor any Retry-After value), this wrapper's retry sleep runs inline inside a live
// serverless request. A large-but-real Retry-After (an extended provider incident, not just an
// adversarial header) would otherwise block the function past its platform execution timeout --
// a hard kill mid-sleep, not a JS exception, which skips every designed fallback below
// (fallbackInsight, FALLBACK_MESSAGE, etc.) since none of them get a chance to run. The OpenAI
// SDK's own internal retry logic caps Retry-After the same way (see its core.js) -- this matches
// that precedent rather than inventing a new number.
const MAX_RETRY_AFTER_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredBackoff(attempt: number): number {
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = base * 0.3;
  return Math.round(base - jitter + Math.random() * jitter * 2);
}

export async function runModelOperation<T>(options: ModelOperationOptions<T>): Promise<ModelOperationResult<T>> {
  const operationId = randomUUID();
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const startedAt = Date.now();
  let lastError: unknown;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsMade = attempt;
    try {
      const data = await options.execute();
      return {
        outcome: 'succeeded',
        data,
        operationId,
        operationName: options.operationName,
        promptVersion: options.promptVersion,
        boundaryVersion: options.boundaryVersion,
        attempts: attemptsMade,
        durationMs: Date.now() - startedAt,
        safeErrorClass: null,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err;
      const retryable = isRetryableProviderError(err);
      console.error(
        `Model operation ${options.operationName} (${operationId}) failed on attempt ${attempt}${retryable ? ', retrying' : ', not retryable'}`,
        err
      );
      if (!retryable || attempt >= maxAttempts) break;
      const retryAfterMs = getRetryAfterMs(err);
      await sleep(retryAfterMs !== null ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) : jitteredBackoff(attempt));
    }
  }

  return {
    outcome: 'failed_safe',
    data: null,
    operationId,
    operationName: options.operationName,
    promptVersion: options.promptVersion,
    boundaryVersion: options.boundaryVersion,
    attempts: attemptsMade,
    durationMs: Date.now() - startedAt,
    safeErrorClass: getCustomerSafeGenerationError(lastError),
    timestamp: new Date().toISOString(),
  };
}
