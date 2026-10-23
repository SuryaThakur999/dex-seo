import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { checkBreaker, recordSuccess, recordFailure } from '@/lib/circuit-breaker';
import { runGenerator } from '@/lib/generation-dispatch';
import { isRateLimitError, getRetryAfterMs } from '@/lib/openai-client';
import { enqueueGenerationJob, claimAndRunGenerationJob, reapStaleGenerationJobs } from '@/lib/generation-worker';

vi.mock('@/lib/db', () => ({
  db: {
    generationJob: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    website: { findUnique: vi.fn(async () => ({ clientProfile: { customerId: 'cust_1' } })), findUniqueOrThrow: vi.fn() },
    clientProfile: { findUnique: vi.fn(() => Promise.resolve(null)) },
    customerFact: { findMany: vi.fn(() => Promise.resolve([])) },
    action: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(() => Promise.resolve([])), create: vi.fn(), update: vi.fn() },
    finding: { findUnique: vi.fn() },
    actionProvenance: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    $queryRaw: vi.fn(async () => [{ id: 'locked' }]),
  },
}));

vi.mock('@/lib/circuit-breaker', () => ({
  checkBreaker: vi.fn(async () => ({ blocked: false })),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('@/lib/generation-dispatch', () => ({
  runGenerator: vi.fn(),
}));

vi.mock('@/lib/openai-client', () => ({
  GENERATION_PROVIDER: 'groq',
  GENERATION_MODEL: 'openai/gpt-oss-120b',
  isRateLimitError: vi.fn(() => false),
  getRetryAfterMs: vi.fn(() => null),
}));

const JOB = {
  id: 'job_1',
  customerId: 'cust_1',
  websiteId: 'web_1',
  actionType: 'meta_description',
  targetRef: 'https://example.com/page',
  payload: { actionType: 'meta_description', url: 'https://example.com/page', title: 'T', metaDescription: null, h1: null },
  status: 'queued',
  attempts: 0,
  cancelRequested: false,
  nextRetryAt: null,
  lastError: null,
  provider: null,
  model: null,
  resultActionId: null,
  createdAt: new Date(),
  startedAt: null,
  completedAt: null,
};

const SUCCESS_OUTCOME = {
  currentValue: null,
  draftContent: 'New description.',
  aiDisclosure: true,
  tokenCost: 20,
  status: 'pending' as const,
  riskTier: 'low' as const,
  guardResult: { outcome: 'pass' as const, checksRun: [], reasoning: 'ok' },
  provenance: {
    producerKind: 'model' as const,
    producerVersion: 'v1',
    findingAssociation: 'unavailable' as const,
    associationReason: 'no Finding id was available at enqueue time',
    generatorInputsSnapshot: {},
    generatorInputsVersion: 'v1',
    validatorInputsSnapshot: null,
    validatorInputsVersion: null,
  },
};

function stubHappyPath(overrides: Partial<typeof JOB> = {}) {
  (db.generationJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
  (db.generationJob.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ ...JOB, ...overrides });
  (db.website.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ clientProfileId: 'cp_1', autoExecuteEnabled: false });
  (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (db.action.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_new' });
  (db.actionProvenance.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'provenance_1' });
}

describe('enqueueGenerationJob', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const ENQUEUE_INPUT = {
    customerId: 'cust_1',
    websiteId: 'web_1',
    actionType: 'meta_description',
    targetRef: 'https://example.com/page',
    inputFingerprint: 'fp',
    payload: JOB.payload as never,
  };

  it('creates a new job when no row exists for this idempotency key', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.generationJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_new' });

    const result = await enqueueGenerationJob(ENQUEUE_INPUT);

    expect(result).toEqual({ id: 'job_new' });
    expect(db.generationJob.update).not.toHaveBeenCalled();
  });

  it('leaves an in-flight or completed job untouched and returns its id', async () => {
    for (const status of ['queued', 'running', 'waiting_retry', 'rate_limited', 'blocked', 'completed']) {
      vi.clearAllMocks();
      (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_existing', status });

      const result = await enqueueGenerationJob(ENQUEUE_INPUT);

      expect(result).toEqual({ id: 'job_existing' });
      expect(db.generationJob.update).not.toHaveBeenCalled();
      expect(db.generationJob.create).not.toHaveBeenCalled();
    }
  });

  it('resets a terminally failed job back to queued instead of leaving it permanently stuck', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_existing', status: 'failed' });

    const result = await enqueueGenerationJob(ENQUEUE_INPUT);

    expect(result).toEqual({ id: 'job_existing' });
    expect(db.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job_existing' },
      data: { status: 'queued', attempts: 0, lastError: null, nextRetryAt: null, startedAt: null, completedAt: null, cancelRequested: false },
    });
  });

  it('resets a cancelled job back to queued', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_existing', status: 'cancelled' });

    await enqueueGenerationJob(ENQUEUE_INPUT);

    expect(db.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job_existing' } }));
  });

  it('resets a completed job back to queued once its resulting Action has been resolved (not pending anymore)', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_existing', status: 'completed', resultActionId: 'action_1' });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'rejected' });

    const result = await enqueueGenerationJob(ENQUEUE_INPUT);

    expect(result).toEqual({ id: 'job_existing' });
    expect(db.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job_existing' },
      data: {
        status: 'queued',
        attempts: 0,
        lastError: null,
        nextRetryAt: null,
        startedAt: null,
        completedAt: null,
        cancelRequested: false,
        resultActionId: null,
      },
    });
  });

  it('leaves a completed job untouched while its resulting Action is still pending review', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_existing', status: 'completed', resultActionId: 'action_1' });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'pending' });

    const result = await enqueueGenerationJob(ENQUEUE_INPUT);

    expect(result).toEqual({ id: 'job_existing' });
    expect(db.generationJob.update).not.toHaveBeenCalled();
  });

  it('resets a completed job whose resulting Action was deleted out from under it', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_existing', status: 'completed', resultActionId: 'action_1' });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await enqueueGenerationJob(ENQUEUE_INPUT);

    expect(db.generationJob.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job_existing' }, data: expect.objectContaining({ status: 'queued' }) }));
  });

  it('falls back to the existing row when a concurrent enqueue wins the race to create it first', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const { Prisma } = await import('@prisma/client');
    const raceError = Object.assign(Object.create(Prisma.PrismaClientKnownRequestError.prototype), { code: 'P2002' });
    (db.generationJob.create as ReturnType<typeof vi.fn>).mockRejectedValue(raceError);
    (db.generationJob.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'job_winner', status: 'queued' });

    const result = await enqueueGenerationJob(ENQUEUE_INPUT);

    expect(result).toEqual({ id: 'job_winner' });
  });

  it('re-throws a create() failure that is not the expected unique-constraint race', async () => {
    (db.generationJob.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (db.generationJob.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection reset'));

    await expect(enqueueGenerationJob(ENQUEUE_INPUT)).rejects.toThrow('connection reset');
  });
});

describe('claimAndRunGenerationJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks() resets call history, not a standing mockReturnValue override -- pin these
    // back to the non-rate-limit default before every test so one test's override can't leak
    // into the next.
    (isRateLimitError as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getRetryAfterMs as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (checkBreaker as ReturnType<typeof vi.fn>).mockResolvedValue({ blocked: false });
  });

  it('is a no-op when another invocation already claimed the job (atomic claim returns count 0)', async () => {
    (db.generationJob.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: false });
    expect(db.generationJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('marks the job cancelled without calling the generator when cancelRequested is set', async () => {
    stubHappyPath({ cancelRequested: true });

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'cancelled' });
    expect(runGenerator).not.toHaveBeenCalled();
  });

  it('does not call the generator, and does not count an attempt, when the circuit breaker is open', async () => {
    stubHappyPath();
    const retryAt = new Date(Date.now() + 60_000);
    (checkBreaker as ReturnType<typeof vi.fn>).mockResolvedValue({ blocked: true, retryAt });

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'blocked' });
    expect(runGenerator).not.toHaveBeenCalled();
    expect(db.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: { status: 'blocked', nextRetryAt: retryAt, provider: 'groq', model: 'openai/gpt-oss-120b' },
    });
  });

  it('on success, writes a new Action and completes the job in one transaction, and records breaker success', async () => {
    stubHappyPath();
    (runGenerator as ReturnType<typeof vi.fn>).mockResolvedValue(SUCCESS_OUTCOME);

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'completed' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.action.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust_1',
          websiteId: 'web_1',
          pageUrl: 'https://example.com/page',
          actionType: 'meta_description',
          draftContent: 'New description.',
          generationStatus: 'succeeded',
          guardResult: { create: expect.objectContaining({ outcome: 'pass' }) },
        }),
      })
    );
    expect(db.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: { status: 'completed', completedAt: expect.any(Date), resultActionId: 'action_new' },
    });
    expect(recordSuccess).toHaveBeenCalledWith('groq', 'openai/gpt-oss-120b');
  });

  it('on success, updates an existing failed Action in place instead of creating a duplicate', async () => {
    stubHappyPath();
    (runGenerator as ReturnType<typeof vi.fn>).mockResolvedValue(SUCCESS_OUTCOME);
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_failed' });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_failed', customerId: 'cust_1', websiteId: 'web_1', status: 'pending', generationStatus: 'failed' });
    (db.action.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_failed' });

    await claimAndRunGenerationJob('job_1');

    expect(db.action.create).not.toHaveBeenCalled();
    expect(db.action.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'action_failed' },
        data: expect.objectContaining({ generationStatus: 'succeeded', draftContent: 'New description.' }),
      })
    );
    expect(db.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: { status: 'completed', completedAt: expect.any(Date), resultActionId: 'action_failed' },
    });
  });

  it('cancels a successful retry if its targeted failed action was decided while generation ran', async () => {
    stubHappyPath();
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_failed' });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_failed', customerId: 'cust_1', websiteId: 'web_1', status: 'approved', generationStatus: 'failed' });
    (runGenerator as ReturnType<typeof vi.fn>).mockResolvedValue(SUCCESS_OUTCOME);

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'cancelled' });
    expect(db.action.update).not.toHaveBeenCalled();
    expect(db.action.create).not.toHaveBeenCalled();
    expect(db.generationJob.update).toHaveBeenCalledWith({ where: { id: 'job_1' }, data: { status: 'cancelled', completedAt: expect.any(Date) } });
  });

  it('retries with backoff on a transient failure before the attempt cap, and records breaker failure', async () => {
    stubHappyPath({ attempts: 0 });
    (runGenerator as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('transient'));

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'waiting_retry' });
    expect(recordFailure).toHaveBeenCalledWith('groq', 'openai/gpt-oss-120b');
    expect(db.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job_1' },
        data: expect.objectContaining({ status: 'waiting_retry', nextRetryAt: expect.any(Date) }),
      })
    );
    expect(db.action.create).not.toHaveBeenCalled();
  });

  it('fails permanently and writes a customer-safe failed Action once GENERATION_MAX_ATTEMPTS is reached', async () => {
    stubHappyPath({ attempts: 2 }); // this claim's attempt becomes the 3rd
    (runGenerator as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('still down'));

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'failed' });
    expect(db.action.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ generationStatus: 'failed', draftContent: '', generationError: expect.any(String) }),
      })
    );
    expect(db.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job_1' }, data: expect.objectContaining({ status: 'failed' }) })
    );
  });

  it('does not replace a targeted action after a terminal failure if it was decided during the provider call', async () => {
    stubHappyPath({ attempts: 2 });
    (db.action.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_failed' });
    (db.action.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'action_failed', customerId: 'cust_1', websiteId: 'web_1', status: 'rejected', generationStatus: 'failed' });
    (runGenerator as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('provider failed'));

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'cancelled' });
    expect(db.action.update).not.toHaveBeenCalled();
    expect(db.action.create).not.toHaveBeenCalled();
  });

  it('sets rate_limited with the provider Retry-After when the error is a rate limit', async () => {
    stubHappyPath();
    const rateLimitErr = new Error('rate limited');
    (runGenerator as ReturnType<typeof vi.fn>).mockRejectedValue(rateLimitErr);
    (isRateLimitError as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (getRetryAfterMs as ReturnType<typeof vi.fn>).mockReturnValue(15_000);

    const result = await claimAndRunGenerationJob('job_1');

    expect(result).toEqual({ processed: true, outcome: 'rate_limited' });
    const calls = (db.generationJob.update as ReturnType<typeof vi.fn>).mock.calls;
    const [lastCall] = calls[calls.length - 1];
    expect(lastCall.data.status).toBe('rate_limited');
    expect(lastCall.data.nextRetryAt.getTime() - Date.now()).toBeGreaterThan(14_000);
  });
});

describe('reapStaleGenerationJobs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resets stale running jobs to waiting_retry for immediate re-claim', async () => {
    await reapStaleGenerationJobs();

    expect(db.generationJob.updateMany).toHaveBeenCalledWith({
      where: { status: 'running', startedAt: { lt: expect.any(Date) } },
      data: { status: 'waiting_retry', nextRetryAt: expect.any(Date) },
    });
  });
});
