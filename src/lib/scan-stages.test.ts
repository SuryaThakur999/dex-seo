import { describe, expect, it } from 'vitest';
import { classifyLogStage, furthestStageReached } from '@/lib/scan-stages';

describe('classifyLogStage', () => {
  it('classifies real run-scan.ts/scan-worker.ts message shapes', () => {
    expect(classifyLogStage('Starting scan for https://example.com...')).toBe('discover');
    expect(classifyLogStage('Found 12 pages to check.')).toBe('discover');
    expect(classifyLogStage('Found 1 page to check.')).toBe('discover');
    expect(classifyLogStage('Checking https://example.com/about...')).toBe('crawl');
    expect(classifyLogStage('SEO Specialist recorded 3 finding(s).')).toBe('analyze');
    expect(classifyLogStage('GEO Specialist recorded 1 finding(s).')).toBe('analyze');
    expect(classifyLogStage('Brand Specialist recorded 2 finding(s).')).toBe('analyze');
    expect(classifyLogStage('Found 2 page(s) worth fixing.')).toBe('analyze');
    expect(classifyLogStage('Skipping https://example.com/about (recently reviewed).')).toBe('analyze');
    expect(classifyLogStage('Drafting a fix for https://example.com/about...')).toBe('analyze');
    expect(classifyLogStage('ProofLayer: pass — https://example.com/about')).toBe('verify');
    expect(classifyLogStage("Couldn't process https://example.com/about: timeout")).toBe('verify');
    expect(classifyLogStage('Scan complete — 5 pages checked, 2 drafts created.')).toBe('save');
  });

  it('returns null for unmatched or job-level failure messages rather than guessing', () => {
    expect(classifyLogStage('Scan failed: connection refused')).toBeNull();
    expect(classifyLogStage('some future message nobody wrote yet')).toBeNull();
    expect(classifyLogStage('')).toBeNull();
  });
});

describe('furthestStageReached', () => {
  it('returns the latest stage reached in STAGE_ORDER, not message order', () => {
    const messages = ['Found 4 pages to check.', 'Checking https://x.com...', 'ProofLayer: pass — https://x.com'];
    expect(furthestStageReached(messages)).toBe('verify');
  });

  it('returns null when no message matches a known stage', () => {
    expect(furthestStageReached(['Scan failed: timeout'])).toBeNull();
    expect(furthestStageReached([])).toBeNull();
  });

  it('does not let an unmatched message reset the furthest stage already reached', () => {
    const messages = ['Checking https://x.com...', 'Scan failed: timeout'];
    expect(furthestStageReached(messages)).toBe('crawl');
  });
});
