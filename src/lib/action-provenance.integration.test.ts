import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimAndRunGenerationJob } from './generation-worker';

// Real PostgreSQL with deterministic canonical_fix generation. Each test rolls back its
// outer transaction; worker transactions use savepoints so append-only rows need no DELETE cleanup.
const harness = vi.hoisted(() => ({ context: null as AsyncLocalStorage<PrismaClient> | null }));
vi.mock('./db', () => ({ db: new Proxy({}, {
  get(_target, key) {
    const client = harness.context?.getStore();
    if (!client) throw new Error('Integration database accessed outside an authorized test');
    const value = Reflect.get(client, key);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) }));
vi.mock('./circuit-breaker', () => ({
  checkBreaker: vi.fn().mockResolvedValue({ blocked: false }),
  recordSuccess: vi.fn().mockResolvedValue(undefined), recordFailure: vi.fn().mockResolvedValue(undefined),
}));

// Never fall back to DATABASE_URL. The coordinator must supply a disposable, migrated database.
const databaseUrl = process.env.DEX_PROVENANCE_TEST_DATABASE_URL;
const authorized = process.env.DEX_PROVENANCE_TEST_DATABASE_APPROVED === 'disposable' && !!databaseUrl;

describe.skipIf(!authorized)('ActionProvenance against real PostgreSQL', () => {
  let client: PrismaClient;
  let connection: PrismaClient;
  let rollback: () => void;
  let transaction: Promise<void>;
  const rollbackMarker = new Error('Roll back test fixtures');
  let customerId: string;
  let otherCustomerId: string;
  let profileId: string;
  let websiteId: string;
  let otherWebsiteId: string;
  const context = new AsyncLocalStorage<PrismaClient>();
  const on = <T>(work: () => Promise<T>) => context.run(client, work);

  async function makeJob(opts: { pageUrl: string; findingId: string | null }) {
    return client.generationJob.create({
      data: {
        customerId, websiteId, actionType: 'canonical_fix', targetRef: opts.pageUrl,
        idempotencyKey: randomUUID(),
        payload: { actionType: 'canonical_fix', pageUrl: opts.pageUrl, currentCanonical: null, findingId: opts.findingId },
      },
    });
  }

  beforeAll(async () => {
    if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
      throw new Error('An explicitly authorized PostgreSQL URL is required');
    }
    harness.context = context;
    connection = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await connection.$connect();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    let ready: () => void;
    let failed: (error: unknown) => void;
    const started = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    const finished = new Promise<void>((resolve) => { rollback = resolve; });
    transaction = connection.$transaction(async (tx) => {
      client = new Proxy(tx, {
        get(target, key) {
          if (key === '$transaction') return async (work: (inner: typeof tx) => Promise<unknown>) => {
            await tx.$executeRawUnsafe('SAVEPOINT worker_transaction');
            try {
              const result = await work(tx);
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT worker_transaction');
              return result;
            } catch (error) {
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT worker_transaction');
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT worker_transaction');
              throw error;
            }
          };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as PrismaClient;
      ready();
      await finished;
      throw rollbackMarker;
    }, { timeout: 30000 }).catch((error) => {
      failed(error);
      if (error !== rollbackMarker) throw error;
    });
    await started;
    customerId = randomUUID(); otherCustomerId = randomUUID(); profileId = randomUUID();
    websiteId = randomUUID(); otherWebsiteId = randomUUID();
    await client.customer.create({ data: { id: customerId, clerkUserId: randomUUID() } });
    await client.customer.create({ data: { id: otherCustomerId, clerkUserId: randomUUID() } });
    await client.clientProfile.create({ data: { id: profileId, customerId, name: 'Provenance integration' } });
    await client.website.create({ data: { id: websiteId, clientProfileId: profileId,
      url: 'https://example.com', normalizedHost: 'example.com' } });
    const otherProfileId = randomUUID();
    await client.clientProfile.create({ data: { id: otherProfileId, customerId: otherCustomerId, name: 'Other tenant' } });
    await client.website.create({ data: { id: otherWebsiteId, clientProfileId: otherProfileId,
      url: 'https://other.example.com', normalizedHost: 'other.example.com' } });
  });
  afterEach(async () => {
    rollback?.();
    await transaction;
  });
  afterAll(async () => { await connection.$disconnect(); });

  it.each(['ActionProvenance', 'ActionProvenanceFinding'] as const)(
    '%s permits inserts and reads but rejects updates, deletes and conflict updates', async (table) => {
      const finding = await client.finding.create({ data: {
        customerId, websiteId, pageUrl: 'https://example.com/append-only', agent: 'seo_specialist',
        ruleId: 'missing_canonical', severity: 'medium', confidence: 'high', evidence: {}, suggestedAction: 'Add canonical',
      } });
      const job = await makeJob({ pageUrl: finding.pageUrl, findingId: finding.id });
      expect(await on(() => claimAndRunGenerationJob(job.id))).toEqual({ processed: true, outcome: 'completed' });
      const provenance = await client.actionProvenance.findFirstOrThrow({ where: { generationJobId: job.id } });
      const link = await client.actionProvenanceFinding.findFirstOrThrow({ where: { actionProvenanceId: provenance.id } });
      const id = table === 'ActionProvenance' ? provenance.id : link.id;
      // Table names come only from the fixed test cases, never external input.
      const select = () => client.$queryRawUnsafe(`SELECT * FROM "${table}" WHERE id = $1`, id);
      const original = await select();
      expect(original).toHaveLength(1);
      expect(await client.$executeRawUnsafe(
        `INSERT INTO "${table}" SELECT * FROM "${table}" WHERE id = $1 ON CONFLICT (id) DO NOTHING`, id,
      )).toBe(0);
      for (const [operation, sql] of [
        ['UPDATE', `UPDATE "${table}" SET id = id WHERE id = $1`],
        ['DELETE', `DELETE FROM "${table}" WHERE id = $1`],
        ['UPDATE', `INSERT INTO "${table}" SELECT * FROM "${table}" WHERE id = $1 ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id`],
      ]) {
        await client.$executeRawUnsafe('SAVEPOINT rejected_mutation');
        try {
          await expect(client.$executeRawUnsafe(sql, id)).rejects.toThrow(
            `append-only; ${operation} on ${table} is not permitted`,
          );
        } finally {
          await client.$executeRawUnsafe('ROLLBACK TO SAVEPOINT rejected_mutation');
          await client.$executeRawUnsafe('RELEASE SAVEPOINT rejected_mutation');
        }
        expect(await select()).toEqual(original);
      }
    },
  );

  it('writes a causal ActionProvenance+ActionProvenanceFinding row for a same-tenant Finding', async () => {
    const finding = await client.finding.create({ data: {
      customerId, websiteId, pageUrl: 'https://example.com/a', agent: 'seo_specialist',
      ruleId: 'missing_canonical', severity: 'medium', confidence: 'high', evidence: {}, suggestedAction: 'Add canonical',
    } });
    const job = await makeJob({ pageUrl: 'https://example.com/a', findingId: finding.id });

    const result = await on(() => claimAndRunGenerationJob(job.id));

    expect(result).toEqual({ processed: true, outcome: 'completed' });
    const provenance = await client.actionProvenance.findFirstOrThrow({ where: { generationJobId: job.id } });
    expect(provenance.findingAssociation).toBe('causal');
    expect(provenance.customerId).toBe(customerId);
    expect(provenance.websiteId).toBe(websiteId);
    const link = await client.actionProvenanceFinding.findFirstOrThrow({ where: { actionProvenanceId: provenance.id } });
    expect(link.findingId).toBe(finding.id);
    expect(link.ruleId).toBe('missing_canonical');
  });

  it('does not link a Finding that belongs to a different customer/website, and still completes', async () => {
    const otherFinding = await client.finding.create({ data: {
      customerId: otherCustomerId, websiteId: otherWebsiteId, pageUrl: 'https://other.example.com/x',
      agent: 'seo_specialist', ruleId: 'missing_canonical', severity: 'medium', confidence: 'high',
      evidence: {}, suggestedAction: 'Add canonical',
    } });
    const job = await makeJob({ pageUrl: 'https://example.com/b', findingId: otherFinding.id });

    const result = await on(() => claimAndRunGenerationJob(job.id));

    expect(result).toEqual({ processed: true, outcome: 'completed' });
    const provenance = await client.actionProvenance.findFirstOrThrow({ where: { generationJobId: job.id } });
    expect(provenance.findingAssociation).toBe('unavailable');
    expect(provenance.associationReason).toMatch(/different customer\/website/);
    const links = await client.actionProvenanceFinding.findMany({ where: { actionProvenanceId: provenance.id } });
    expect(links).toHaveLength(0);
  });

  it('gives a retried job a new executionId without overwriting the prior attempt\'s row', async () => {
    const job = await makeJob({ pageUrl: 'https://example.com/c', findingId: null });
    await on(() => claimAndRunGenerationJob(job.id));
    const first = await client.actionProvenance.findFirstOrThrow({ where: { generationJobId: job.id } });

    // Force a second real attempt against the same job/action, same as a retry would.
    await client.generationJob.update({ where: { id: job.id }, data: { status: 'queued' } });
    await on(() => claimAndRunGenerationJob(job.id));

    const rows = await client.actionProvenance.findMany({ where: { generationJobId: job.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].executionId).toBe(first.executionId);
    expect(rows[1].executionId).not.toBe(first.executionId);
    expect(rows[1].attemptNumber).toBe(2);
  });
});
