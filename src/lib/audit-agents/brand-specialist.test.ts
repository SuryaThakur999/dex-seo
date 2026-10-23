import { describe, it, expect } from 'vitest';
import { extractCandidateClaims, runBrandSpecialist, checkRestrictedWording } from './brand-specialist';

function htmlWithBody(text: string): string {
  return `<html><body>${text}</body></html>`;
}

describe('extractCandidateClaims', () => {
  it('extracts claim-shaped phrases from body text', () => {
    const matches = extractCandidateClaims(htmlWithBody('We are the #1 rated platform, trusted by 10,000+ customers.'));
    expect(matches.map((m) => m.text)).toEqual(expect.arrayContaining(['#1']));
  });

  it('returns an empty array when no claim-shaped text exists', () => {
    expect(extractCandidateClaims(htmlWithBody('A simple page about our services.'))).toEqual([]);
  });

  it('does not throw on script/style content mixed into the page', () => {
    const html = '<html><body><script>var best = "#1 secret key";</script><p>Nothing here.</p></body></html>';
    expect(() => extractCandidateClaims(html)).not.toThrow();
  });

  it('does not false-positive-match inside a non-English word containing the ASCII substring (Unicode-aware boundary)', () => {
    // Found live against real production content (a German privacy-policy page): ASCII \b
    // treats "ä" as a non-word character, so plain /\bbest\b/i matched "best" inside
    // "bestätigen" (German for "confirm"). Real regression, not hypothetical.
    const matches = extractCandidateClaims(htmlWithBody('Der Anbieter ist noch zu bestätigen.'));
    expect(matches).toEqual([]);
  });

  it('still matches "best" as a genuine standalone word', () => {
    const matches = extractCandidateClaims(htmlWithBody('This is the best service available.'));
    expect(matches.map((m) => m.text)).toContain('best');
  });
});

describe('runBrandSpecialist', () => {
  it('returns no finding when every candidate claim is already an approved CustomerFact', () => {
    const html = htmlWithBody('We serve 500+ customers across Europe.');
    const findings = runBrandSpecialist({
      pageUrl: 'https://example.com',
      html,
      approvedFacts: [{ claim: '500+ customers across Europe', category: 'reach' }],
    });
    expect(findings).toEqual([]);
  });

  it('returns one bundled finding for unverified claims, not one per match', () => {
    const html = htmlWithBody('The #1 rated, award-winning, guaranteed solution trusted by 10,000+ customers.');
    const findings = runBrandSpecialist({ pageUrl: 'https://example.com', html, approvedFacts: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('unverified_claim_candidate');
    expect((findings[0].evidence.matches as unknown[]).length).toBeGreaterThan(1);
  });

  it('caps the bundled matches and records the real total separately', () => {
    // 13 distinct pattern-triggering phrases in one page, well past the 10-match cap.
    const html = htmlWithBody(
      [
        '#1 rated',
        'the best',
        'the fastest',
        'the cheapest',
        'top-rated service',
        'a leading provider',
        '50% faster',
        'clinically proven',
        'award-winning support',
        'certified experts',
        'guaranteed results',
        'voted best',
        '999+ customers',
      ].join('. '),
    );
    const findings = runBrandSpecialist({ pageUrl: 'https://example.com', html, approvedFacts: [] });
    expect(findings).toHaveLength(1);
    expect((findings[0].evidence.matches as unknown[]).length).toBe(10);
    expect(findings[0].evidence.totalFound).toBe(13);
  });

  it('only flags claims not covered by an approved fact, leaving verified ones out', () => {
    const html = htmlWithBody('We are the #1 rated platform. We are also the fastest in the industry.');
    const findings = runBrandSpecialist({
      pageUrl: 'https://example.com',
      html,
      approvedFacts: [{ claim: '#1 rated platform', category: 'reputation' }],
    });
    expect(findings).toHaveLength(1);
    const texts = (findings[0].evidence.matches as { text: string }[]).map((m) => m.text);
    expect(texts).not.toContain('#1');
    expect(texts).toContain('fastest');
  });
});

describe('checkRestrictedWording', () => {
  const URL = 'https://example.com/';

  it('returns nothing when the restricted-wording list is empty', () => {
    expect(checkRestrictedWording(URL, htmlWithBody('Guaranteed results every time.'), [])).toEqual([]);
  });

  it('flags a configured phrase actually present in the page copy', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('We offer guaranteed results.'), ['guaranteed']);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('restricted_wording_found');
    expect((findings[0].evidence as { matches: { phrase: string }[] }).matches[0].phrase).toBe('guaranteed');
  });

  it('returns nothing when the configured phrase is absent', () => {
    expect(checkRestrictedWording(URL, htmlWithBody('A plain page with no issues.'), ['guaranteed'])).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('GUARANTEED results.'), ['guaranteed']);
    expect(findings).toHaveLength(1);
  });

  it('matches across punctuation boundaries', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('Results, guaranteed! Act now.'), ['guaranteed']);
    expect(findings).toHaveLength(1);
  });

  it('bundles repeated occurrences of the same phrase into one finding, not one per occurrence', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('Guaranteed. Truly guaranteed. Absolutely guaranteed.'), ['guaranteed']);
    expect(findings).toHaveLength(1);
    expect((findings[0].evidence as { matches: unknown[] }).matches).toHaveLength(1);
  });

  it('matches a configured multi-word phrase', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('We are the number one rated platform.'), ['number one rated']);
    expect(findings).toHaveLength(1);
  });

  it('matches German characters (umlauts) correctly', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('Wir bieten die beste Qualität garantiert.'), ['garantiert']);
    expect(findings).toHaveLength(1);
  });

  it('does not false-positive match a restricted word appearing only inside a longer unrelated word', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('This page is completely carefree and easy to use.'), ['free']);
    expect(findings).toEqual([]);
  });

  it('bundles multiple different restricted phrases found on the same page into one finding', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('Guaranteed and 100% risk-free results.'), ['guaranteed', 'risk-free']);
    expect(findings).toHaveLength(1);
    expect((findings[0].evidence as { matches: { phrase: string }[] }).matches.map((m) => m.phrase).sort()).toEqual(['guaranteed', 'risk-free']);
  });

  it('never quotes an entire preference history into evidence — only the matched phrase and a short excerpt', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('Guaranteed results.'), ['guaranteed', 'unrelated-unused-phrase']);
    const evidence = findings[0].evidence as { matches: { phrase: string }[] };
    expect(evidence.matches.map((m) => m.phrase)).toEqual(['guaranteed']);
  });

  it('describes the finding as a configured preference and explicitly disclaims it as a legal or ranking issue', () => {
    const findings = checkRestrictedWording(URL, htmlWithBody('Guaranteed results.'), ['guaranteed']);
    expect(findings[0].limitations).toMatch(/preference/i);
    expect(findings[0].limitations).toMatch(/not.*(legal|defect)/i);
  });
});
