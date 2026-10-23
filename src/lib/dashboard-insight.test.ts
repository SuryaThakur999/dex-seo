import { describe, it, expect, vi } from 'vitest';
import { generateDashboardInsight } from './dashboard-insight';

describe('generateDashboardInsight', () => {
  it('returns the OpenAI-generated summary on success', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: 'Scans are clean this week.', totalTokens: 42 });

    const result = await generateDashboardInsight(
      { pagesScanned: 41, pagesFlagged: 13, guardCatchesDelta: -40, pendingCount: 2 },
      callOpenAI
    );

    expect(result).toBe('Scans are clean this week.');
    expect(callOpenAI).toHaveBeenCalledTimes(1);
    const prompt = callOpenAI.mock.calls[0][0] as string;
    expect(prompt).toContain('41');
    expect(prompt).toContain('13');
  });

  it('falls back to a plain generated sentence when OpenAI fails', async () => {
    const callOpenAI = vi.fn().mockRejectedValue(new Error('rate limited'));

    const result = await generateDashboardInsight(
      { pagesScanned: 41, pagesFlagged: 13, guardCatchesDelta: -40, pendingCount: 2 },
      callOpenAI
    );

    expect(result).toBe('13 issues found on 41 pages in the latest scan, 2 waiting for your review.');
  });

  it('falls back when OpenAI returns an empty response', async () => {
    const callOpenAI = vi.fn().mockResolvedValue({ content: '', totalTokens: 0 });

    const result = await generateDashboardInsight(
      { pagesScanned: 10, pagesFlagged: 0, guardCatchesDelta: null, pendingCount: 0 },
      callOpenAI
    );

    expect(result).toBe('0 issues found on 10 pages in the latest scan, 0 waiting for your review.');
  });

  it('matches the Work feed: uses the latest scan count, not an all-time total', async () => {
    const callOpenAI = vi.fn().mockRejectedValue(new Error('unused'));

    const result = await generateDashboardInsight(
      // All-time ProofLayer guard catches can be 0 while the Work feed shows many findings
      // from the latest scan -- the summary must reflect the latter, not the former.
      { pagesScanned: 41, pagesFlagged: 13, guardCatchesDelta: null, pendingCount: 11 },
      callOpenAI
    );

    expect(result).toBe('13 issues found on 41 pages in the latest scan, 11 waiting for your review.');
  });
});
