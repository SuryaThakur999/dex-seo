import type { FindingSeverity } from '@prisma/client';

// Brief section 5's required evidence schema, same shape as seo-specialist.ts's
// SeoFindingInput. `agent`/`ruleVersion` are filled in by the caller (run-scan).
export interface GeoFindingInput {
  ruleId: string;
  severity: FindingSeverity;
  confidence: 'high' | 'medium' | 'low';
  evidence: Record<string, unknown>;
  limitations: string | null;
  suggestedAction: string;
}

// Known AI crawlers that fetch content for LLM training or live answer generation. A site can
// legitimately choose to block these while still allowing search/Dex crawling — that is an
// observable robots.txt fact, not a hypothesis about actual AI-answer-engine behavior, and the
// brief explicitly requires that separation ("does not invent AI citations, platform coverage,
// or a proprietary visibility score").
const AI_CRAWLER_USER_AGENTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'PerplexityBot',
  'CCBot',
  'cohere-ai',
  'Bytespider',
];

interface RobotsBlock {
  userAgents: string[];
  disallowsAll: boolean;
}

// Minimal robots.txt group parser: consecutive User-agent lines share the directives that
// follow, up to the next directive. Deliberately narrow — only cares whether a named group's
// directives include a blanket `Disallow: /`, which is all this check needs.
function parseRobotsBlocks(robotsTxt: string): RobotsBlock[] {
  const blocks: RobotsBlock[] = [];
  let pendingAgents: string[] = [];
  let current: RobotsBlock | null = null;
  let groupOpen = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (groupOpen) {
        pendingAgents = []; // a directive already closed the previous group — start a new one
        groupOpen = false;
        current = null;
      }
      pendingAgents.push(value);
    } else if (key === 'disallow') {
      if (!current) {
        current = { userAgents: [...pendingAgents], disallowsAll: false };
        blocks.push(current);
      }
      groupOpen = true;
      if (value === '/') current.disallowsAll = true;
    } else if (key === 'allow') {
      groupOpen = true;
    }
  }
  return blocks;
}

// Which AI crawlers this robots.txt specifically and completely blocks (a real, observable
// fact). Deliberately ignores a blanket `User-agent: * / Disallow: /` — that blocks Dex's own
// crawler too, so the page would never reach this check at all (isAllowedByRobots already
// filters it out upstream). This only flags a site that lets normal/search crawling through but
// specifically shuts out named AI crawlers.
export function checkAiCrawlerAccess(robotsTxt: string): string[] {
  const blocks = parseRobotsBlocks(robotsTxt);
  const blocked = new Set<string>();
  for (const block of blocks) {
    if (!block.disallowsAll) continue;
    for (const agent of block.userAgents) {
      const known = AI_CRAWLER_USER_AGENTS.find((a) => a.toLowerCase() === agent.toLowerCase());
      if (known) blocked.add(known);
    }
  }
  return [...blocked];
}

// One finding per scan (site-level fact, not per-page) when the site specifically blocks one
// or more named AI crawlers.
export function runGeoSpecialistForSite(input: { siteUrl: string; robotsTxt: string }): GeoFindingInput[] {
  const blocked = checkAiCrawlerAccess(input.robotsTxt);
  if (blocked.length === 0) return [];
  return [
    {
      ruleId: 'ai_crawlers_blocked',
      severity: 'medium',
      confidence: 'high',
      evidence: { siteUrl: input.siteUrl, blockedCrawlers: blocked },
      limitations:
        'Confirms robots.txt disallows these crawlers by name — it does not measure actual citation or visibility inside any AI answer engine.',
      suggestedAction: `robots.txt for ${input.siteUrl} disallows ${blocked.join(', ')}. If AI-answer discoverability matters for this site, review whether blocking them is intentional.`,
    },
  ];
}

// Checked once, on the homepage only (see run-scan.ts) — entity/organization identity is a
// site-level concern, not a per-article one; flagging it on every individual page would be
// repetitive noise for the same underlying fact.
export function runGeoSpecialistForHomepage(input: { pageUrl: string; hasEntityMarkup: boolean }): GeoFindingInput[] {
  if (input.hasEntityMarkup) return [];
  return [
    {
      ruleId: 'missing_entity_markup',
      severity: 'low',
      confidence: 'medium',
      evidence: { pageUrl: input.pageUrl, checkedTypes: ['Organization', 'WebSite', 'Person', 'LocalBusiness', 'Corporation'] },
      limitations:
        'Only checks for JSON-LD entity types — a site that identifies itself via microdata or RDFa instead would still be flagged here.',
      suggestedAction: `Add Organization or WebSite JSON-LD structured data to ${input.pageUrl} so systems reading the page can reliably identify what it represents.`,
    },
  ];
}
