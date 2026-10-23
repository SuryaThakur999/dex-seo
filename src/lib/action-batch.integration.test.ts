import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionRevision, decideActionBatch, type BatchRequest } from './action-batch';
import { actionDecisionInclude, decideAction } from './action-decision';
import { getPagePerformanceForRange, listPagePerformance, type PagePerformance } from './gsc-client';
import { runGenerator, type GenerationOutcome } from './generation-dispatch';
import { claimAndRunGenerationJob } from './generation-worker';
import { GET as measureOutcomes } from '@/app/api/cron/measure-outcomes/route';
import { recordEvaluationCase } from './preference-evaluation-events';

const harness = vi.hoisted(() => ({ context: null as AsyncLocalStorage<PrismaClient> | null }));
vi.mock('./db', () => ({ db: new Proxy({}, {
  get(_target, key) {
    const client = harness.context?.getStore();
    if (!client) throw new Error('Integration database accessed outside an authorized test');
    const value = Reflect.get(client, key);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) }));
vi.mock('./crypto', () => ({ decrypt: vi.fn(token => token) }));
vi.mock('./gsc-client', async original => ({
  ...await original<typeof import('./gsc-client')>(), listPagePerformance: vi.fn(), getPagePerformanceForRange: vi.fn(),
}));
vi.mock('./preference-evaluation-events', () => ({ recordEvaluationCase: vi.fn() }));
vi.mock('./generation-dispatch', () => ({ runGenerator: vi.fn() }));
vi.mock('./circuit-breaker', () => ({
  checkBreaker: vi.fn().mockResolvedValue({ blocked: false }),
  recordSuccess: vi.fn().mockResolvedValue(undefined), recordFailure: vi.fn().mockResolvedValue(undefined),
}));

// Never fall back to DATABASE_URL. The coordinator must supply a disposable, migrated database.
const databaseUrl = process.env.DEX_BATCH_TEST_DATABASE_URL;
const authorized = process.env.DEX_BATCH_TEST_DATABASE_APPROVED === 'disposable' && !!databaseUrl;

describe.skipIf(!authorized)('batch decisions with independent PostgreSQL clients', () => {
  let clients: [PrismaClient, PrismaClient];
  let customerId: string;
  let websiteId: string;
  let profileId: string;
  let actor: string;
  let ids: string[];
  const context = new AsyncLocalStorage<PrismaClient>();
  const on = <T>(client: PrismaClient, work: () => Promise<T>) => context.run(client, work);
  const batch = (client: PrismaClient, request: BatchRequest) => on(client, () =>
    decideActionBatch({ customerId, actorClerkUserId: actor, request }));
  const single = (decision: 'approve' | 'edit' | 'reject' | 'revert', actionId = ids[0]) => on(clients[1], async () => {
    const action = await clients[1].action.findUniqueOrThrow({ where: { id: actionId }, include: actionDecisionInclude });
    return decideAction({ customerId, actorClerkUserId: actor, actionId, decision,
      expectedRevision: actionRevision(action), draftContent: 'Edited draft' });
  });
  const rows = () => clients[1].action.findMany({ where: { customerId }, orderBy: { id: 'asc' } });
  const audits = () => clients[1].auditLogEntry.findMany({ where: { customerId } });
  async function request(selected = ids.slice(0, 2)): Promise<BatchRequest> {
    const actions = await clients[0].action.findMany({
      where: { id: { in: selected } }, include: actionDecisionInclude,
    });
    return { requestId: randomUUID(), websiteId, decision: 'approve',
      items: actions.map(action => ({ actionId: action.id, revision: actionRevision(action) })) };
  }
  function providerBarrier(count: number) {
    const entered = deferred<void>();
    const release = deferred<PagePerformance[]>();
    let arrivals = 0;
    vi.mocked(listPagePerformance).mockImplementation(() => {
      if (++arrivals === count) entered.resolve();
      return release.promise;
    });
    return { entered: entered.promise, release: () => release.resolve([]) };
  }

  beforeAll(async () => {
    if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
      throw new Error('An explicitly authorized PostgreSQL URL is required');
    }
    harness.context = context;
    clients = [new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
      new PrismaClient({ datasources: { db: { url: databaseUrl } } })];
    await Promise.all(clients.map(client => client.$connect()));
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(listPagePerformance).mockResolvedValue([]);
    vi.mocked(recordEvaluationCase).mockResolvedValue(undefined);
    customerId = randomUUID(); profileId = randomUUID(); websiteId = randomUUID(); actor = randomUUID();
    ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    await clients[0].customer.create({ data: { id: customerId, clerkUserId: actor } });
    await clients[0].clientProfile.create({ data: { id: profileId, customerId, name: 'Batch integration' } });
    await clients[0].website.create({ data: { id: websiteId, clientProfileId: profileId,
      url: 'https://example.com', normalizedHost: 'example.com',
      gscRefreshToken: 'test-token', gscPropertyUrl: 'sc-domain:example.com' } });
    for (const id of ids) {
      await clients[0].action.create({ data: { id, customerId, websiteId,
        pageUrl: `https://example.com/${id}`, actionType: 'meta_description',
        currentValue: 'Before', draftContent: 'Draft', guardResult: { create: {
          outcome: 'pass', reasoning: 'Checks passed',
          checksRun: [{ check: 'length', result: 'pass', detail: 'Within limit' }],
        } } } });
    }
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    if (!customerId) return;
    await clients[0].generationJob.deleteMany({ where: { customerId } });
    await clients[0].guardResult.deleteMany({ where: { action: { customerId } } });
    await clients[0].auditLogEntry.deleteMany({ where: { customerId } });
    await clients[0].action.deleteMany({ where: { customerId } });
    await clients[0].website.deleteMany({ where: { id: websiteId } });
    await clients[0].clientProfile.deleteMany({ where: { id: profileId } });
    await clients[0].customer.deleteMany({ where: { id: customerId } });
  });
  afterAll(async () => { await Promise.all((clients ?? []).map(client => client.$disconnect())); });

  it('serializes identical requests and commits only one receipt set', async () => {
    const input = await request();
    const barrier = providerBarrier(2);
    const pending = Promise.all([batch(clients[0], input), batch(clients[1], input)]);
    await barrier.entered;
    barrier.release();
    const [first, second] = await pending;
    expect(second).toEqual(first);
    expect((await rows()).map(row => row.status)).toEqual(['approved', 'approved', 'pending']);
    expect((await audits()).map(event => event.eventType).sort())
      .toEqual(['action_batch_decided', 'action_decided', 'action_decided']);
    expect(recordEvaluationCase).toHaveBeenCalledTimes(2);
  });

  it('rejects the losing overlapping batch without partial writes', async () => {
    const left = await request(ids.slice(0, 2));
    const right = await request(ids.slice(1));
    const barrier = providerBarrier(2);
    const pending = Promise.allSettled([batch(clients[0], left), batch(clients[1], right)]);
    await barrier.entered;
    barrier.release();
    const results = await pending;
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect((await rows()).filter(row => row.status === 'approved')).toHaveLength(2);
    expect((await rows()).filter(row => row.status === 'pending')).toHaveLength(1);
    expect(await audits()).toHaveLength(3);
    expect(recordEvaluationCase).toHaveBeenCalledTimes(2);
  });

  it.each(['edit', 'reject'] as const)('discards a batch after a competing single %s commits', async decision => {
    const input = await request();
    const barrier = providerBarrier(1);
    const pending = batch(clients[0], input);
    const settled = Promise.allSettled([pending]);
    await barrier.entered;
    // Edit also fetches GSC; only the batch provider call remains held.
    vi.mocked(listPagePerformance).mockResolvedValue([]);
    await single(decision);
    barrier.release();
    expect((await settled)[0]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    const persisted = await rows();
    expect(persisted[0].status).toBe(decision === 'edit' ? 'edited' : 'rejected');
    expect(persisted.slice(1).map(row => row.status)).toEqual(['pending', 'pending']);
    expect(await audits()).toHaveLength(1);
    expect(await clients[1].guardResult.count({ where: { action: { customerId } } })).toBe(3);
  });

  it('replays a committed request after response loss without another provider call', async () => {
    const input = await request();
    await batch(clients[0], input);
    vi.mocked(listPagePerformance).mockRejectedValue(new Error('Retry must not fetch'));
    const replay = await batch(clients[1], input);
    expect(replay.actionIds).toEqual(ids.slice(0, 2));
    expect(listPagePerformance).toHaveBeenCalledTimes(1);
    expect(recordEvaluationCase).toHaveBeenCalledTimes(2);
    expect(await audits()).toHaveLength(3);
  });

  it('decides the restored pending revision after a competing approval and revert', async () => {
    const input = await request();
    const barrier = providerBarrier(1);
    const pending = batch(clients[0], input);
    await barrier.entered;
    vi.mocked(listPagePerformance).mockResolvedValue([]);
    await single('approve');
    await single('revert');
    barrier.release();
    await pending;
    expect((await rows()).map(row => row.status)).toEqual(['approved', 'approved', 'pending']);
    expect((await audits()).map(event => event.eventType).sort()).toEqual([
      'action_batch_decided', 'action_decided', 'action_decided', 'action_decided', 'action_reverted',
    ]);
  });

  it('rolls back every action and receipt when the batch audit insert fails', async () => {
    const failingClient = clients[0].$extends({ query: { auditLogEntry: { async create({ args, query }) {
      if (args.data.eventType === 'action_batch_decided') throw new Error('Injected batch audit failure');
      return query(args);
    } } } });
    await expect(batch(failingClient as unknown as PrismaClient, await request()))
      .rejects.toThrow('Injected batch audit failure');
    expect((await rows()).map(row => row.status)).toEqual(['pending', 'pending', 'pending']);
    expect(await audits()).toHaveLength(0);
    expect(recordEvaluationCase).not.toHaveBeenCalled();
  });

  it.each(['edit', 'reject'] as const)('cancels a held generation after a single %s commits', async decision => {
    await clients[0].action.update({ where: { id: ids[0] }, data: { generationStatus: 'failed' } });
    const originalGuard = await clients[0].guardResult.findUniqueOrThrow({ where: { actionId: ids[0] } });
    const job = await clients[0].generationJob.create({ data: {
      customerId, websiteId, actionType: 'meta_description', targetRef: `https://example.com/${ids[0]}`,
      idempotencyKey: randomUUID(), payload: { actionType: 'meta_description', url: `https://example.com/${ids[0]}`,
        title: 'Title', metaDescription: 'Before', h1: 'Heading', findingId: null },
    } });
    const entered = deferred<void>();
    const release = deferred<GenerationOutcome>();
    vi.mocked(runGenerator).mockImplementation(() => { entered.resolve(); return release.promise; });
    const pending = on(clients[0], () => claimAndRunGenerationJob(job.id));
    await entered.promise;
    await single(decision);
    release.resolve({ currentValue: 'Provider before', draftContent: 'Provider draft', aiDisclosure: true,
      tokenCost: 1, status: 'pending', riskTier: 'low', guardResult: {
        outcome: 'pass', checksRun: [], reasoning: 'Provider checks',
      },
      provenance: {
        producerKind: 'model', producerVersion: 'v1', findingAssociation: 'unavailable', associationReason: null,
        generatorInputsSnapshot: {}, generatorInputsVersion: 'v1', validatorInputsSnapshot: null, validatorInputsVersion: null,
      } });
    expect(await pending).toEqual({ processed: true, outcome: 'cancelled' });
    const action = (await rows())[0];
    expect(action.status).toBe(decision === 'edit' ? 'edited' : 'rejected');
    expect(action.draftContent).toBe(decision === 'edit' ? 'Edited draft' : 'Draft');
    expect(action.generationStatus).toBe('failed');
    expect(await clients[1].guardResult.findUnique({ where: { actionId: ids[0] } })).toEqual(originalGuard);
    expect(await clients[1].generationJob.findUnique({ where: { id: job.id } }))
      .toMatchObject({ status: 'cancelled', resultActionId: null });
    expect(await audits()).toHaveLength(1);
  });

  it.each([false, true])('discards an old cron response after revert, reapprove=%s', async reapprove => {
    vi.stubEnv('CRON_SECRET', 'integration-secret');
    vi.useFakeTimers({ toFake: ['Date'] });
    const decisionAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(decisionAt);
    const metrics = { url: `https://example.com/${ids[0]}`, impressions: 0, clicks: 0, ctr: 0 };
    vi.mocked(listPagePerformance).mockResolvedValue([metrics]);
    await single('approve');
    const original = (await rows())[0];
    vi.setSystemTime(new Date('2026-02-03T00:00:00.000Z'));
    const entered = deferred<void>();
    const release = deferred<PagePerformance[]>();
    vi.mocked(getPagePerformanceForRange).mockImplementation(() => { entered.resolve(); return release.promise; });
    const pending = on(clients[0], () => measureOutcomes(new NextRequest('https://example.com/api/cron/measure-outcomes', {
      headers: { authorization: 'Bearer integration-secret' },
    })));
    await entered.promise;
    await single('revert');
    if (reapprove) {
      vi.setSystemTime(decisionAt);
      await single('approve');
      const renewed = (await rows())[0];
      expect(renewed.decidedAt).toEqual(original.decidedAt);
      expect(renewed.baselineCapturedAt).toEqual(original.baselineCapturedAt);
      expect(renewed.baselinePerformance).not.toEqual(original.baselinePerformance);
    }
    release.resolve([{ ...metrics, clicks: 10, impressions: 100, ctr: 0.1 }]);
    expect((await pending).status).toBe(200);
    const persisted = (await rows())[0];
    expect(persisted.status).toBe(reapprove ? 'approved' : 'pending');
    expect(persisted.outcomePerformance).toBeNull();
    expect(persisted.outcomeMeasuredAt).toBeNull();
    expect(await audits()).toHaveLength(reapprove ? 3 : 2);
  });

  it('persists an observed zero separately from an absent GSC row', async () => {
    vi.mocked(listPagePerformance).mockResolvedValue([
      { url: `https://example.com/${ids[0]}`, impressions: 0, clicks: 0, ctr: 0 },
    ]);
    await batch(clients[0], await request());
    const persisted = await rows();
    expect(persisted[0].baselinePerformance).toMatchObject({
      availability: 'observed_gsc_row', impressions: 0, clicks: 0, ctr: 0,
    });
    expect(persisted[0].baselineCapturedAt).not.toBeNull();
    expect(persisted[1].baselinePerformance).toBeNull();
    expect(persisted[1].baselineCapturedAt).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
