import { describe, it, expect } from 'vitest';
import { buildEvidenceLedger, buildAgentEvidenceSummary, buildOrchestratorSummaryRow } from './agent-evidence-ledger';

describe('buildEvidenceLedger', () => {
  it('attributes a real specialist-produced log line to the real agent name', () => {
    const entries = buildEvidenceLedger([
      { message: 'SEO Specialist recorded 3 finding(s).', createdAt: new Date('2026-09-14T00:00:01Z') },
    ]);
    expect(entries[0].agent).toBe('SEO Specialist');
  });

  it('leaves an unattributed message with agent null, never a guessed name', () => {
    const entries = buildEvidenceLedger([{ message: 'Starting scan for https://example.com', createdAt: new Date() }]);
    expect(entries[0].agent).toBeNull();
  });

  it('orders entries chronologically regardless of input order', () => {
    const entries = buildEvidenceLedger([
      { message: 'B', createdAt: new Date('2026-09-14T00:02:00Z') },
      { message: 'A', createdAt: new Date('2026-09-14T00:01:00Z') },
    ]);
    expect(entries.map((e) => e.message)).toEqual(['A', 'B']);
  });
});

describe('buildAgentEvidenceSummary', () => {
  it('keeps only the latest real entry per agent, dropping unattributed lines', () => {
    const entries = buildEvidenceLedger([
      { message: 'Starting scan for https://example.com', createdAt: new Date('2026-09-14T00:00:00Z') },
      { message: 'SEO Specialist recorded 3 finding(s).', createdAt: new Date('2026-09-14T00:01:00Z') },
      { message: 'SEO Specialist recorded 7 finding(s).', createdAt: new Date('2026-09-14T00:02:00Z') },
      { message: 'GEO Specialist recorded 1 finding(s).', createdAt: new Date('2026-09-14T00:01:30Z') },
    ]);
    const summary = buildAgentEvidenceSummary(entries);
    expect(summary).toHaveLength(2);
    expect(summary.find((r) => r.agent === 'SEO Specialist')?.detail).toBe('SEO Specialist recorded 7 finding(s).');
  });

  it('returns an empty list rather than a fabricated row when nothing is attributed', () => {
    expect(buildAgentEvidenceSummary([])).toEqual([]);
  });
});

describe('buildOrchestratorSummaryRow', () => {
  it('returns a real row with the actual consolidated count', () => {
    const row = buildOrchestratorSummaryRow(2, new Date('2026-09-14T00:00:00Z'));
    expect(row?.agent).toBe('Growth Orchestrator');
    expect(row?.detail).toBe('Consolidated 2 overlapping findings from this scan.');
  });

  it('uses singular wording for exactly one consolidation', () => {
    const row = buildOrchestratorSummaryRow(1, new Date('2026-09-14T00:00:00Z'));
    expect(row?.detail).toBe('Consolidated 1 overlapping finding from this scan.');
  });

  it('returns null rather than a fabricated "0 combined" row when nothing was consolidated', () => {
    expect(buildOrchestratorSummaryRow(0, new Date())).toBeNull();
  });
});
