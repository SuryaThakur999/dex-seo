import { describe, it, expect } from 'vitest';
import { checkAiCrawlerAccess, runGeoSpecialistForSite, runGeoSpecialistForHomepage } from './geo-specialist';

describe('checkAiCrawlerAccess', () => {
  it('detects a named AI crawler fully blocked in its own group', () => {
    const robotsTxt = ['User-agent: GPTBot', 'Disallow: /', '', 'User-agent: *', 'Disallow: /admin'].join('\n');
    expect(checkAiCrawlerAccess(robotsTxt)).toEqual(['GPTBot']);
  });

  it('detects multiple AI crawlers grouped under consecutive User-agent lines', () => {
    const robotsTxt = ['User-agent: GPTBot', 'User-agent: ClaudeBot', 'Disallow: /'].join('\n');
    expect(checkAiCrawlerAccess(robotsTxt).sort()).toEqual(['ClaudeBot', 'GPTBot']);
  });

  it('is case-insensitive matching the crawler name', () => {
    const robotsTxt = ['User-agent: gptbot', 'Disallow: /'].join('\n');
    expect(checkAiCrawlerAccess(robotsTxt)).toEqual(['GPTBot']);
  });

  it('does not flag a blanket User-agent: * block — that would already block Dex itself', () => {
    const robotsTxt = ['User-agent: *', 'Disallow: /'].join('\n');
    expect(checkAiCrawlerAccess(robotsTxt)).toEqual([]);
  });

  it('does not flag a named crawler that is only partially disallowed (a specific path, not everything)', () => {
    const robotsTxt = ['User-agent: GPTBot', 'Disallow: /private/'].join('\n');
    expect(checkAiCrawlerAccess(robotsTxt)).toEqual([]);
  });

  it('returns empty for a normal, permissive robots.txt', () => {
    expect(checkAiCrawlerAccess('User-agent: *\nDisallow:')).toEqual([]);
    expect(checkAiCrawlerAccess('')).toEqual([]);
  });

  it('ignores an unrecognized crawler name even if fully blocked', () => {
    const robotsTxt = ['User-agent: SomeRandomBot', 'Disallow: /'].join('\n');
    expect(checkAiCrawlerAccess(robotsTxt)).toEqual([]);
  });
});

describe('runGeoSpecialistForSite', () => {
  it('returns one ai_crawlers_blocked finding naming every blocked crawler', () => {
    const robotsTxt = ['User-agent: GPTBot', 'User-agent: ClaudeBot', 'Disallow: /'].join('\n');
    const findings = runGeoSpecialistForSite({ siteUrl: 'https://example.com', robotsTxt });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('ai_crawlers_blocked');
    expect(findings[0].evidence.blockedCrawlers).toEqual(['GPTBot', 'ClaudeBot']);
    expect(findings[0].confidence).toBe('high');
  });

  it('returns no finding when no AI crawler is blocked', () => {
    expect(runGeoSpecialistForSite({ siteUrl: 'https://example.com', robotsTxt: 'User-agent: *\nDisallow:' })).toEqual([]);
  });
});

describe('runGeoSpecialistForHomepage', () => {
  it('returns a missing_entity_markup finding when the homepage has no entity JSON-LD', () => {
    const findings = runGeoSpecialistForHomepage({ pageUrl: 'https://example.com', hasEntityMarkup: false });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('missing_entity_markup');
    expect(findings[0].severity).toBe('low');
  });

  it('returns no finding when entity markup is present', () => {
    expect(runGeoSpecialistForHomepage({ pageUrl: 'https://example.com', hasEntityMarkup: true })).toEqual([]);
  });
});
