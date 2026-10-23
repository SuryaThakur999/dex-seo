import { describe, it, expect } from 'vitest';
import {
  generateCanonicalFix,
  validateCanonicalFix,
  CANONICAL_FIX_RULE_IDS,
  CANONICAL_FIX_ACTION_TYPE,
  generateStructuredDataFix,
  generateEntityMarkupFix,
  validateJsonLdFix,
  STRUCTURED_DATA_FIX_RULE_IDS,
  STRUCTURED_DATA_FIX_ACTION_TYPE,
  ENTITY_MARKUP_FIX_RULE_IDS,
  ENTITY_MARKUP_FIX_ACTION_TYPE,
} from './deterministic-remediation';

describe('generateCanonicalFix', () => {
  it('produces a self-referencing canonical tag', () => {
    expect(generateCanonicalFix('https://example.com/pricing')).toBe(
      '<link rel="canonical" href="https://example.com/pricing">'
    );
  });

  it('escapes an ampersand in the URL so the attribute stays well-formed', () => {
    expect(generateCanonicalFix('https://example.com/?a=1&b=2')).toBe(
      '<link rel="canonical" href="https://example.com/?a=1&amp;b=2">'
    );
  });

  it('escapes a literal quote so it cannot break out of the href attribute', () => {
    expect(generateCanonicalFix('https://example.com/"onmouseover=alert(1)')).toBe(
      '<link rel="canonical" href="https://example.com/&quot;onmouseover=alert(1)">'
    );
  });
});

describe('validateCanonicalFix', () => {
  it('passes for a correctly generated tag', () => {
    const pageUrl = 'https://example.com/about';
    const draft = generateCanonicalFix(pageUrl);
    const result = validateCanonicalFix(draft, pageUrl);
    expect(result.outcome).toBe('pass');
    expect(result.checksRun.every((c) => c.result === 'pass')).toBe(true);
  });

  it('blocks when the draft references a different page than intended', () => {
    const draft = generateCanonicalFix('https://example.com/wrong-page');
    const result = validateCanonicalFix(draft, 'https://example.com/intended-page');
    expect(result.outcome).toBe('block');
    expect(result.checksRun.find((c) => c.check === 'references-correct-page')?.result).toBe('fail');
  });

  it('blocks when the draft is not a well-formed canonical tag', () => {
    const result = validateCanonicalFix('not a tag', 'https://example.com/');
    expect(result.outcome).toBe('block');
    expect(result.checksRun.find((c) => c.check === 'tag-well-formed')?.result).toBe('fail');
  });
});

describe('generateStructuredDataFix', () => {
  it('produces a WebPage JSON-LD script including the real page title', () => {
    const draft = generateStructuredDataFix('https://example.com/about', 'About us');
    expect(draft).toBe(
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","url":"https://example.com/about","name":"About us"}</script>'
    );
  });

  it('omits name entirely rather than inventing one when no title exists', () => {
    const draft = generateStructuredDataFix('https://example.com/about', null);
    expect(draft).not.toContain('"name"');
    expect(JSON.parse(draft.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      url: 'https://example.com/about',
    });
  });

  it('neutralizes a closing script tag hidden inside the page title so it cannot break out of the <script> element', () => {
    const draft = generateStructuredDataFix('https://example.com/x', 'Evil</script><script>alert(1)</script>');
    expect(draft).not.toMatch(/<\/script><script>alert\(1\)/);
    // The payload survives intact once properly parsed back out.
    const result = validateJsonLdFix(draft, 'WebPage', 'https://example.com/x');
    expect(result.outcome).toBe('pass');
  });

  it('preserves the original case of an escaped closing-script sequence inside the title, rather than flattening it to lowercase', () => {
    const draft = generateStructuredDataFix('https://example.com/x', 'How to use </SCRIPT> tags safely');
    expect(draft).toContain('<\\/SCRIPT>');
    expect(draft).not.toContain('<\\/script>');

    const jsonPart = draft.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(jsonPart).name).toBe('How to use </SCRIPT> tags safely');

    const result = validateJsonLdFix(draft, 'WebPage', 'https://example.com/x');
    expect(result.outcome).toBe('pass');
  });
});

describe('generateEntityMarkupFix', () => {
  it('produces an Organization JSON-LD script from the real ClientProfile name and homepage url', () => {
    const draft = generateEntityMarkupFix('https://example.com', 'Acme Inc');
    expect(draft).toBe(
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme Inc","url":"https://example.com"}</script>'
    );
  });
});

describe('validateJsonLdFix', () => {
  it('passes for a correctly generated structured-data fix', () => {
    const draft = generateStructuredDataFix('https://example.com/about', 'About us');
    const result = validateJsonLdFix(draft, 'WebPage', 'https://example.com/about');
    expect(result.outcome).toBe('pass');
  });

  it('passes for a correctly generated entity-markup fix', () => {
    const draft = generateEntityMarkupFix('https://example.com', 'Acme Inc');
    const result = validateJsonLdFix(draft, 'Organization', 'https://example.com');
    expect(result.outcome).toBe('pass');
  });

  it('blocks when the schema type does not match what was expected', () => {
    const draft = generateEntityMarkupFix('https://example.com', 'Acme Inc');
    const result = validateJsonLdFix(draft, 'WebPage', 'https://example.com');
    expect(result.outcome).toBe('block');
    expect(result.checksRun.find((c) => c.check === 'schema-type-correct')?.result).toBe('fail');
  });

  it('blocks when the url does not match the intended page', () => {
    const draft = generateStructuredDataFix('https://example.com/wrong', 'Title');
    const result = validateJsonLdFix(draft, 'WebPage', 'https://example.com/intended');
    expect(result.outcome).toBe('block');
    expect(result.checksRun.find((c) => c.check === 'references-correct-page')?.result).toBe('fail');
  });

  it('blocks malformed content that is not a JSON-LD script block at all', () => {
    const result = validateJsonLdFix('not a script tag', 'WebPage', 'https://example.com/');
    expect(result.outcome).toBe('block');
    expect(result.checksRun.find((c) => c.check === 'tag-well-formed')?.result).toBe('fail');
  });
});

describe('constants', () => {
  it('covers both canonical-related rule IDs', () => {
    expect(CANONICAL_FIX_RULE_IDS).toEqual(['missing_canonical', 'invalid_canonical']);
  });

  it('exposes the actionType string used to create/dedup these Actions', () => {
    expect(CANONICAL_FIX_ACTION_TYPE).toBe('canonical_fix');
  });

  it('exposes the structured-data-fix rule ID and actionType', () => {
    expect(STRUCTURED_DATA_FIX_RULE_IDS).toEqual(['missing_structured_data']);
    expect(STRUCTURED_DATA_FIX_ACTION_TYPE).toBe('structured_data_fix');
  });

  it('exposes the entity-markup-fix rule ID and actionType', () => {
    expect(ENTITY_MARKUP_FIX_RULE_IDS).toEqual(['missing_entity_markup']);
    expect(ENTITY_MARKUP_FIX_ACTION_TYPE).toBe('entity_markup_fix');
  });
});
