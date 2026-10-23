// Minimal observable execution contract (Phase 7A item 5) -- deliberately not the full
// survival-gate lifecycle (queued/degraded/quarantined/rolled_back/...) from the broader
// directive. That machinery has no real failure population to justify it yet: the four audit
// agents are synchronous, non-throwing pure functions with zero recorded production failures.
// This wrapper exists so a later phase (7B, when agents gain real model/provider failure
// surfaces) can extend an existing contract instead of inventing one under pressure.

export type AgentExecutionStatus = 'passed' | 'blocked' | 'failed';

export interface AgentExecutionResult<T> {
  status: AgentExecutionStatus;
  data: T | null;
  validationErrors: string[];
  durationMs: number;
  agentVersion: string;
}

// 'blocked' is reserved for a future case (e.g. required evidence genuinely unavailable) --
// not reachable through this wrapper today, since the callers passed to it either succeed or
// throw. Left honestly unused rather than faked to look "active."
export function runAgentSafely<T>(agentVersion: string, fn: () => T): AgentExecutionResult<T> {
  const start = performance.now();
  try {
    const data = fn();
    return { status: 'passed', data, validationErrors: [], durationMs: performance.now() - start, agentVersion };
  } catch (err) {
    return {
      status: 'failed',
      data: null,
      validationErrors: [err instanceof Error ? err.message : String(err)],
      durationMs: performance.now() - start,
      agentVersion,
    };
  }
}
