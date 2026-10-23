import { describe, it, expect } from 'vitest';
import { runAgentSafely } from './agent-execution';

describe('runAgentSafely', () => {
  it('returns passed with the real data on success', () => {
    const result = runAgentSafely('v1', () => [1, 2, 3]);
    expect(result.status).toBe('passed');
    expect(result.data).toEqual([1, 2, 3]);
    expect(result.validationErrors).toEqual([]);
    expect(result.agentVersion).toBe('v1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns failed with the real error message when the function throws', () => {
    const result = runAgentSafely('v1', () => {
      throw new Error('boom');
    });
    expect(result.status).toBe('failed');
    expect(result.data).toBeNull();
    expect(result.validationErrors).toEqual(['boom']);
  });

  it('stringifies a non-Error throw rather than dropping it', () => {
    const result = runAgentSafely('v1', () => {
      throw 'plain string failure';
    });
    expect(result.status).toBe('failed');
    expect(result.validationErrors).toEqual(['plain string failure']);
  });

  it('carries the given agentVersion through on both success and failure', () => {
    expect(runAgentSafely('v2', () => 1).agentVersion).toBe('v2');
    expect(
      runAgentSafely('v2', () => {
        throw new Error('x');
      }).agentVersion
    ).toBe('v2');
  });
});
