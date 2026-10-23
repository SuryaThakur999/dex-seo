import { describe, it, expect } from 'vitest';
import { RateLimitError } from 'openai';
import {
  CUSTOMER_SAFE_GENERATION_ERROR,
  CUSTOMER_SAFE_RATE_LIMIT_ERROR,
  getCustomerSafeGenerationError,
} from './customer-safe-error';

describe('getCustomerSafeGenerationError', () => {
  it('returns the rate-limit-specific message for a RateLimitError', () => {
    const err = new RateLimitError(
      429,
      {},
      'Rate limit exceeded',
      new Headers() as unknown as ConstructorParameters<typeof RateLimitError>[3]
    );
    expect(getCustomerSafeGenerationError(err)).toBe(CUSTOMER_SAFE_RATE_LIMIT_ERROR);
  });

  it('returns the generic message for any other failure', () => {
    expect(getCustomerSafeGenerationError(new Error('OPENAI_API_KEY is missing'))).toBe(CUSTOMER_SAFE_GENERATION_ERROR);
  });

  it('returns the generic message for a non-Error thrown value', () => {
    expect(getCustomerSafeGenerationError('a string was thrown')).toBe(CUSTOMER_SAFE_GENERATION_ERROR);
  });
});
