import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { checkBreaker, recordSuccess, recordFailure } from '@/lib/circuit-breaker';

vi.mock('@/lib/db', () => ({
  db: {
    providerCircuitBreaker: { upsert: vi.fn(), update: vi.fn() },
  },
}));

const PROVIDER = 'groq';
const MODEL = 'openai/gpt-oss-120b';

function breakerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'breaker_1',
    provider: PROVIDER,
    model: MODEL,
    consecutiveFailures: 0,
    openUntil: null,
    cooldownMs: 300_000,
    lastFailureAt: null,
    lastSuccessAt: null,
    ...overrides,
  };
}

describe('checkBreaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is not blocked for a fresh (provider, model) pair', async () => {
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(breakerRow());

    const result = await checkBreaker(PROVIDER, MODEL);

    expect(result).toEqual({ blocked: false });
    expect(db.providerCircuitBreaker.upsert).toHaveBeenCalledWith({
      where: { provider_model: { provider: PROVIDER, model: MODEL } },
      create: { provider: PROVIDER, model: MODEL },
      update: {},
    });
  });

  it('is blocked while openUntil is still in the future', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(breakerRow({ openUntil: retryAt }));

    const result = await checkBreaker(PROVIDER, MODEL);

    expect(result).toEqual({ blocked: true, retryAt });
  });

  it('is not blocked once openUntil has passed -- this call is the half-open probe', async () => {
    const pastRetryAt = new Date(Date.now() - 1000);
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(breakerRow({ openUntil: pastRetryAt }));

    const result = await checkBreaker(PROVIDER, MODEL);

    expect(result).toEqual({ blocked: false });
  });
});

describe('recordSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets consecutiveFailures, clears openUntil, and resets cooldown to the base value', async () => {
    await recordSuccess(PROVIDER, MODEL);

    expect(db.providerCircuitBreaker.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_model: { provider: PROVIDER, model: MODEL } },
        update: expect.objectContaining({ consecutiveFailures: 0, openUntil: null, cooldownMs: 300_000 }),
      })
    );
  });
});

describe('recordFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments consecutiveFailures without opening the breaker below the threshold', async () => {
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      breakerRow({ consecutiveFailures: 2, lastFailureAt: new Date() })
    );

    await recordFailure(PROVIDER, MODEL);

    expect(db.providerCircuitBreaker.update).toHaveBeenCalledWith({
      where: { id: 'breaker_1' },
      data: { consecutiveFailures: 3, lastFailureAt: expect.any(Date) },
    });
  });

  it('opens the breaker at the current cooldown once the 5th consecutive failure lands', async () => {
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      breakerRow({ consecutiveFailures: 4, lastFailureAt: new Date(), cooldownMs: 300_000 })
    );

    await recordFailure(PROVIDER, MODEL);

    expect(db.providerCircuitBreaker.update).toHaveBeenCalledWith({
      where: { id: 'breaker_1' },
      data: { consecutiveFailures: 5, openUntil: expect.any(Date), lastFailureAt: expect.any(Date) },
    });
    const [[{ data }]] = (db.providerCircuitBreaker.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(data.openUntil.getTime() - Date.now()).toBeGreaterThan(299_000);
  });

  it('does not compound with a stale failure streak older than the 10-minute window', async () => {
    const staleFailureAt = new Date(Date.now() - 11 * 60 * 1000);
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      breakerRow({ consecutiveFailures: 4, lastFailureAt: staleFailureAt })
    );

    await recordFailure(PROVIDER, MODEL);

    expect(db.providerCircuitBreaker.update).toHaveBeenCalledWith({
      where: { id: 'breaker_1' },
      data: { consecutiveFailures: 1, lastFailureAt: expect.any(Date) },
    });
  });

  it('doubles and caps the cooldown, and reopens, when a half-open probe itself fails', async () => {
    const pastOpenUntil = new Date(Date.now() - 1000);
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      breakerRow({ consecutiveFailures: 5, openUntil: pastOpenUntil, cooldownMs: 300_000, lastFailureAt: new Date() })
    );

    await recordFailure(PROVIDER, MODEL);

    expect(db.providerCircuitBreaker.update).toHaveBeenCalledWith({
      where: { id: 'breaker_1' },
      data: { consecutiveFailures: 6, cooldownMs: 600_000, openUntil: expect.any(Date), lastFailureAt: expect.any(Date) },
    });
  });

  it('caps the doubled cooldown at 30 minutes', async () => {
    const pastOpenUntil = new Date(Date.now() - 1000);
    (db.providerCircuitBreaker.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      breakerRow({ consecutiveFailures: 8, openUntil: pastOpenUntil, cooldownMs: 1_800_000, lastFailureAt: new Date() })
    );

    await recordFailure(PROVIDER, MODEL);

    expect(db.providerCircuitBreaker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cooldownMs: 1_800_000 }) })
    );
  });
});
