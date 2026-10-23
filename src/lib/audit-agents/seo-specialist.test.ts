import { describe, it, expect } from 'vitest';
import { runSeoSpecialist, checkStatusCode } from './seo-specialist';

const PAGE_URL = 'https://example.com/pricing';

function baseSignals() {
  return { canonicalUrl: 'https://example.com/pricing', hasStructuredData: true, internalLinkCount: 3 };
}

describe('runSeoSpecialist', () => {
  it('returns no findings when canonical, structured data, and internal links are all present', () => {
    const findings = runSeoSpecialist({ pageUrl: PAGE_URL, signals: baseSignals() });
    expect(findings).toEqual([]);
  });

  it('flags a missing canonical with high confidence and no limitations caveat', () => {
    const findings = runSeoSpecialist({ pageUrl: PAGE_URL, signals: { ...baseSignals(), canonicalUrl: null } });
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: 'missing_canonical', severity: 'medium', confidence: 'high', limitations: null }),
    ]);
  });

  it('flags a canonical pointing at a different URL, not a missing one', () => {
    const findings = runSeoSpecialist({
      pageUrl: PAGE_URL,
      signals: { ...baseSignals(), canonicalUrl: 'https://example.com/other-page' },
    });
    expect(findings).toEqual([expect.objectContaining({ ruleId: 'canonical_points_elsewhere' })]);
  });

  it('flags an unparseable canonical value as invalid rather than crashing', () => {
    const findings = runSeoSpecialist({
      pageUrl: PAGE_URL,
      signals: { ...baseSignals(), canonicalUrl: 'http://exa mple.com/bad host' },
    });
    expect(findings).toEqual([expect.objectContaining({ ruleId: 'invalid_canonical' })]);
  });

  it('flags missing structured data with a limitations caveat about JSON-LD-only detection', () => {
    const findings = runSeoSpecialist({ pageUrl: PAGE_URL, signals: { ...baseSignals(), hasStructuredData: false } });
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: 'missing_structured_data', limitations: expect.stringContaining('JSON-LD') }),
    ]);
  });

  it('flags zero internal links', () => {
    const findings = runSeoSpecialist({ pageUrl: PAGE_URL, signals: { ...baseSignals(), internalLinkCount: 0 } });
    expect(findings).toEqual([expect.objectContaining({ ruleId: 'zero_internal_links' })]);
  });

  it('returns every applicable finding together, not just the first match', () => {
    const findings = runSeoSpecialist({
      pageUrl: PAGE_URL,
      signals: { canonicalUrl: null, hasStructuredData: false, internalLinkCount: 0 },
    });
    const ruleIds = findings.map((f) => f.ruleId);
    expect(ruleIds).toEqual(['missing_canonical', 'missing_structured_data', 'zero_internal_links']);
  });

  it('carries the pageUrl into every finding evidence payload', () => {
    const findings = runSeoSpecialist({ pageUrl: PAGE_URL, signals: { ...baseSignals(), canonicalUrl: null } });
    expect(findings[0].evidence).toMatchObject({ pageUrl: PAGE_URL });
  });
});

describe('checkStatusCode', () => {
  it('returns no findings for a real 2xx status', () => {
    expect(checkStatusCode(PAGE_URL, 200)).toEqual([]);
  });

  it('returns no findings for a 3xx status (safeFetch already followed and revalidated redirects)', () => {
    expect(checkStatusCode(PAGE_URL, 301)).toEqual([]);
  });

  it('flags a 4xx status as medium severity', () => {
    const findings = checkStatusCode(PAGE_URL, 404);
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: 'broken_page_status', severity: 'medium', evidence: { pageUrl: PAGE_URL, statusCode: 404 } }),
    ]);
  });

  it('flags a 5xx status as high severity', () => {
    const findings = checkStatusCode(PAGE_URL, 503);
    expect(findings).toEqual([expect.objectContaining({ ruleId: 'broken_page_status', severity: 'high' })]);
  });
});
