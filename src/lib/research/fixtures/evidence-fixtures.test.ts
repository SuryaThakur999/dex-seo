import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURES } from './evidence-fixtures';
import { normalizeEvidence, labelConfidence } from '../evidence-normalizer';
import { callAgentReach, AgentReachTimeoutError, AgentReachMalformedResponseError } from '../providers/agent-reach-client';

const now = new Date('2026-10-14T00:00:00Z');

describe('acceptance fixtures', () => {
  it('undated: kept but flagged low-confidence, never dropped silently', () => {
    const items = normalizeEvidence(FIXTURES.undated, 30, now);
    expect(items).toHaveLength(1);
    expect(items[0].limitations.length).toBeGreaterThan(0);
  });

  it('stale: dropped by the 30-day window', () => {
    expect(normalizeEvidence(FIXTURES.stale, 30, now)).toHaveLength(0);
  });

  it('syndicated: deduplicated to one item', () => {
    expect(normalizeEvidence(FIXTURES.syndicated, 30, now)).toHaveLength(1);
  });

  it('unavailable_source: an empty connector result labels insufficient_evidence, not an error', () => {
    const items = normalizeEvidence(FIXTURES.unavailable_source, 30, now);
    expect(labelConfidence(items)).toBe('insufficient_evidence');
  });

  it('prompt_injection: the excerpt is preserved as inert data -- non-execution is proved where\n' +
     '   this text reaches an LLM prompt (G3 Task 11, same untrusted-data-boundary pattern as\n' +
     '   profile-suggestion-extractor.test.ts); this test only documents the fixture is kept intact', () => {
    const items = normalizeEvidence(FIXTURES.prompt_injection, 30, now);
    expect(items[0].excerpt).toContain('Ignore all previous instructions');
  });
});

// Release blockers per council amendment 6 (added via overseer's e2aa89f commands): exercised
// against AgentReachClient (Task 3b), not ResearchResult[] -- they test the client/provider
// boundary itself, not the normalizer.
describe('agent_reach_timeout and agent_reach_malformed fixtures', () => {
  beforeEach(() => {
    process.env.AGENT_REACH_INTERNAL_SECRET = 'test-secret';
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_REACH_INTERNAL_SECRET;
  });

  it('agent_reach_timeout: the function never responds inside the client timeout -- surfaces as a typed error, never an unhandled rejection or a silently-empty result', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    );
    await expect(callAgentReach({ channel: 'web', url: 'https://slow.test/page' }, { timeoutMs: 10 }))
      .rejects.toBeInstanceOf(AgentReachTimeoutError);
  });

  it('agent_reach_malformed: a 200 response missing required fields is rejected by the runtime shape check, never passed through as a partially-valid ResearchResult', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ title: 'Missing canonicalUrl and the rest' }),
    });
    await expect(callAgentReach({ channel: 'web', url: 'https://broken.test/page' }))
      .rejects.toBeInstanceOf(AgentReachMalformedResponseError);
  });
});
