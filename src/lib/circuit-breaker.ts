import { db } from '@/lib/db';

// Phase 1C (docs/superpowers/specs/2026-09-28-phase1c-generation-queue-adr.md): shared
// circuit breaker keyed by (provider, model), not per-tenant -- a provider outage is a shared
// external fact, so every tenant's jobs against that provider+model pause together rather than
// each independently rediscovering the same outage.

// 5 consecutive job-level failures for the same (provider, model) within 10 minutes is a strong,
// fast signal of real provider trouble at this volume (at most ~30 generation attempts/scan,
// ~5 scans/day) -- the SDK's own maxRetries:2 already absorbs a single flaky call before a job
// attempt is even marked failed, so 5 in a row is not ordinary noise.
const OPEN_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const BASE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_COOLDOWN_MS = 30 * 60 * 1000;

export interface BreakerCheckResult {
  blocked: boolean;
  retryAt?: Date;
}

async function getOrCreateBreaker(provider: string, model: string) {
  return db.providerCircuitBreaker.upsert({
    where: { provider_model: { provider, model } },
    create: { provider, model },
    update: {},
  });
}

// A job past `openUntil` is deliberately treated as eligible here (not "still open") -- it's
// the one half-open probe the ADR calls for. Real traffic against this breaker is ~30 jobs/scan
// processed sequentially (never concurrently), so there is no meaningful race between two jobs
// both reading "cooldown expired" at once -- not worth an atomic claim on top of the job-level
// claim generation-worker.ts already does.
export async function checkBreaker(provider: string, model: string): Promise<BreakerCheckResult> {
  const breaker = await getOrCreateBreaker(provider, model);
  if (breaker.openUntil && breaker.openUntil.getTime() > Date.now()) {
    return { blocked: true, retryAt: breaker.openUntil };
  }
  return { blocked: false };
}

export async function recordSuccess(provider: string, model: string): Promise<void> {
  await db.providerCircuitBreaker.upsert({
    where: { provider_model: { provider, model } },
    create: { provider, model, lastSuccessAt: new Date() },
    update: {
      consecutiveFailures: 0,
      openUntil: null,
      cooldownMs: BASE_COOLDOWN_MS,
      lastSuccessAt: new Date(),
    },
  });
}

export async function recordFailure(provider: string, model: string): Promise<void> {
  const breaker = await getOrCreateBreaker(provider, model);
  const now = new Date();

  // A failure streak that went quiet for 10+ minutes doesn't compound with a fresh one --
  // otherwise a provider blip from hours ago could combine with today's first failure to trip
  // the breaker on effectively one real event.
  const streakIsFresh = breaker.lastFailureAt !== null && now.getTime() - breaker.lastFailureAt.getTime() < FAILURE_WINDOW_MS;
  const consecutiveFailures = streakIsFresh ? breaker.consecutiveFailures + 1 : 1;

  // `openUntil` being set at all (even if already past) means this failure is the outcome of
  // the one half-open probe the ADR allows -- a failed probe doubles the cooldown and reopens,
  // rather than waiting for a fresh 5-failure streak to reopen at the base cooldown again.
  const wasOpen = breaker.openUntil !== null;

  if (wasOpen) {
    const cooldownMs = Math.min(breaker.cooldownMs * 2, MAX_COOLDOWN_MS);
    await db.providerCircuitBreaker.update({
      where: { id: breaker.id },
      data: { consecutiveFailures, cooldownMs, openUntil: new Date(now.getTime() + cooldownMs), lastFailureAt: now },
    });
    return;
  }

  if (consecutiveFailures >= OPEN_THRESHOLD) {
    await db.providerCircuitBreaker.update({
      where: { id: breaker.id },
      data: { consecutiveFailures, openUntil: new Date(now.getTime() + breaker.cooldownMs), lastFailureAt: now },
    });
    return;
  }

  await db.providerCircuitBreaker.update({
    where: { id: breaker.id },
    data: { consecutiveFailures, lastFailureAt: now },
  });
}
