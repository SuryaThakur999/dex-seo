import { describe, it, expect } from 'vitest';
import { friendlyLogMessage } from './friendly-log-message';

// Every input string here is copied verbatim from a real logStep(...) call in
// run-scan.ts / scan-worker.ts, not guessed — a regression here means the friendly
// mapper has silently drifted from the real message shapes it's supposed to match.
describe('friendlyLogMessage', () => {
  it('rewrites the real scan-start message', () => {
    expect(friendlyLogMessage('Starting scan for https://example.com...')).toBe('Website acquired.');
  });

  it('rewrites a real page-discovery count, singular and plural', () => {
    expect(friendlyLogMessage('Found 12 pages to check.')).toBe('12 pages discovered.');
    expect(friendlyLogMessage('Found 1 page to check.')).toBe('1 page discovered.');
  });

  it('keeps the real per-page checking line, just as friendly as the raw text', () => {
    expect(friendlyLogMessage('Checking https://example.com/about...')).toBe('Checking https://example.com/about...');
  });

  it('rewrites each specialist line distinctly, preserving the real finding count', () => {
    expect(friendlyLogMessage('SEO Specialist recorded 3 finding(s).')).toBe('Technical SEO checked — 3 findings.');
    expect(friendlyLogMessage('GEO Specialist recorded 1 finding(s).')).toBe('AI-discoverability checked — 1 finding.');
    expect(friendlyLogMessage('Brand Specialist recorded 0 finding(s).')).toBe('Brand and content checked — 0 findings.');
  });

  it('rewrites the real opportunity count with correct singular/plural', () => {
    expect(friendlyLogMessage('Found 1 page(s) worth fixing.')).toBe('1 opportunity ready to draft.');
    expect(friendlyLogMessage('Found 5 page(s) worth fixing.')).toBe('5 opportunities ready to draft.');
  });

  it('rewrites every real skip reason honestly, not as one generic "skipped" that loses why', () => {
    expect(friendlyLogMessage('Skipping https://example.com/x (already has a pending draft).')).toBe(
      'Already has a draft in progress — skipped.'
    );
    expect(friendlyLogMessage('Skipping https://example.com/x (recently reviewed).')).toBe('Recently reviewed — skipped.');
    expect(friendlyLogMessage('Skipping https://example.com/x (content unchanged since last check).')).toBe(
      'No changes since last check — skipped.'
    );
  });

  it('rewrites the real ProofLayer outcome line into "Draft passed ProofLayer", never a bare PASS', () => {
    expect(friendlyLogMessage('ProofLayer: pass — https://example.com/x')).toBe('Draft passed ProofLayer.');
    expect(friendlyLogMessage('ProofLayer: flag — https://example.com/x')).toBe('ProofLayer flagged this draft for review.');
    expect(friendlyLogMessage('ProofLayer: block — https://example.com/x')).toBe('ProofLayer blocked this draft.');
  });

  it('rewrites the real (already-redacted) failure line without re-adding any raw detail', () => {
    expect(friendlyLogMessage("Couldn't process https://example.com/x.")).toBe("Couldn't process this page.");
  });

  it('rewrites the real scan-complete summary, preserving real counts', () => {
    expect(friendlyLogMessage('Scan complete — 3 pages checked, 1 draft created.')).toBe('Scan complete — 3 pages checked, 1 draft ready.');
    expect(friendlyLogMessage('Scan complete — 1 page checked, 0 drafts created.')).toBe('Scan complete — 1 page checked, 0 drafts ready.');
  });

  it('returns an unmatched message unchanged rather than guessing at a rewrite', () => {
    expect(friendlyLogMessage('Some future message shape nobody wrote a pattern for yet.')).toBe(
      'Some future message shape nobody wrote a pattern for yet.'
    );
  });
});
