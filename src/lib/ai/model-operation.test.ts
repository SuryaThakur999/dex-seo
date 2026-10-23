import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimitError } from 'openai';
import { CUSTOMER_SAFE_RATE_LIMIT_ERROR, CUSTOMER_SAFE_GENERATION_ERROR } from '@/lib/customer-safe-error';
import { runModelOperation } from './model-operation';

function rateLimitError(retryAfterSeconds?: string): RateLimitError {
  const headers = retryAfterSeconds ? { 'retry-after': retryAfterSeconds } : {};
  return new RateLimitError(429, {}, 'Rate limit exceeded', headers as unknown as ConstructorParameters<typeof RateLimitError>[3]);
}

describe('runModelOperation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('succeeds on the first attempt without sleeping', async () => {
    const execute = vi.fn().mockResolvedValue('ok');

    const result = await runModelOperation({ operationName: 'op', promptVersion: 'v1', boundaryVersion: 'v1', execute });

    expect(result.outcome).toBe('succeeded');
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(result.safeErrorClass).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error using the provider Retry-After header, then succeeds', async () => {
    const execute = vi.fn().mockRejectedValueOnce(rateLimitError('2')).mockResolvedValueOnce('recovered');

    const promise = runModelOperation({ operationName: 'op', promptVersion: 'v1', boundaryVersion: 'v1', execute });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.outcome).toBe('succeeded');
    expect(result.data).toBe('recovered');
    expect(result.attempts).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('caps an oversized Retry-After header instead of sleeping the full duration inline', async () => {
    // A real (non-adversarial) extended-outage Retry-After could exceed the platform's function
    // timeout -- this sleep runs inline inside a live request, unlike Phase 1C's
    // generation-worker.ts, which persists nextRetryAt and returns instead of blocking. Asserts
    // the cap by advancing time to just past it and confirming the retry has already fired --
    // if the cap were absent, this would still be asleep at that point and the test would hang
    // until real time-based flush, which vi.advanceTimersByTimeAsync surfaces as a timeout.
    const execute = vi.fn().mockRejectedValueOnce(rateLimitError('600')).mockResolvedValueOnce('recovered');

    const promise = runModelOperation({ operationName: 'op', promptVersion: 'v1', boundaryVersion: 'v1', execute });
    await vi.advanceTimersByTimeAsync(5_000); // MAX_RETRY_AFTER_MS, not the header's 600s
    const result = await promise;

    expect(result.outcome).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts on a persistently retryable error and returns a customer-safe error class', async () => {
    const execute = vi.fn().mockRejectedValue(rateLimitError('1'));

    const promise = runModelOperation({ operationName: 'op', promptVersion: 'v1', boundaryVersion: 'v1', maxAttempts: 3, execute });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result.outcome).toBe('failed_safe');
    expect(result.data).toBeNull();
    expect(result.attempts).toBe(3);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.safeErrorClass).toBe(CUSTOMER_SAFE_RATE_LIMIT_ERROR);
  });

  it('does not retry a non-retryable error, and stops after one attempt', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('OPENAI_API_KEY is missing'));

    const result = await runModelOperation({ operationName: 'op', promptVersion: 'v1', boundaryVersion: 'v1', execute });

    expect(result.outcome).toBe('failed_safe');
    expect(result.attempts).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.safeErrorClass).toBe(CUSTOMER_SAFE_GENERATION_ERROR);
  });

  it('stamps operationName/promptVersion/boundaryVersion and a real operationId/timestamp onto every result', async () => {
    const execute = vi.fn().mockResolvedValue('ok');

    const result = await runModelOperation({ operationName: 'dashboard_insight', promptVersion: 'v2', boundaryVersion: 'v1', execute });

    expect(result.operationName).toBe('dashboard_insight');
    expect(result.promptVersion).toBe('v2');
    expect(result.boundaryVersion).toBe('v1');
    expect(result.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });
});
