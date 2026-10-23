import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { OpportunityBoard } from './opportunity-board';
import type { OpportunityGroup } from '@/lib/opportunity-board';
import type { DecisionRecord } from '@/lib/agent-orchestrator';

// Matches the project's existing convention for hookless function components (see
// seo-findings-panel.test.tsx, scan-stage-breadcrumb.test.tsx): call the component as a plain
// function and walk the returned element tree — no @testing-library/react in this repo.
//
// Navigates to the decision-record `<div>` specifically (rather than stringifying the whole
// tree) because the row's other children reach into `next/link`, whose module object is
// self-referential and breaks `JSON.stringify` with "Converting circular structure to JSON".

const WEBSITE_ID = 'site_1';

function decisionRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    issue: 'Missing structured data (SEO + GEO)',
    resolutionRule: 'seo_geo_missing_structured_data',
    participatingAgents: ['seo_specialist', 'geo_specialist'],
    evidenceRefs: ['seo_specialist:missing_structured_data:/'],
    reason: 'Both agents found the same underlying absence of structured data.',
    timestamp: '2026-01-01T00:00:00.000Z',
    recommendations: [],
    agreement: 'agreed',
    disagreement: null,
    finalRecommendation: 'Add Organization or WebSite JSON-LD structured data.',
    confidence: 'high',
    limitations: null,
    owner: 'not_applicable',
    measurementPlan:
      'Measured via GSC search performance over the standard 28-day observation window after an approved change goes live, same window Outcomes already uses.',
    ...overrides,
  };
}

function group(overrides: Partial<OpportunityGroup> = {}): OpportunityGroup {
  return {
    key: 'consolidated:seo_geo_missing_structured_data',
    issueLabel: 'Missing structured data (SEO + GEO)',
    pageCount: 1,
    status: 'found',
    proofLayer: null,
    samplePageUrl: 'https://example.com/',
    severity: 'low',
    contributors: [
      {
        agent: 'seo_specialist',
        ruleId: 'missing_structured_data',
        pageUrl: 'https://example.com/',
        evidence: {},
        suggestedAction: 'Add structured data.',
        limitations: null,
      },
    ],
    consolidationReason: 'Both agents found the same underlying issue.',
    ...overrides,
  };
}

// Element tree: Card > [CardHeader, CardContent] > [table, ...] > [thead, tbody] >
// Fragment[0] (one group) > [row, contributorsRow?] > td > details > [summary, div] >
// [noAutoFixReason?, consolidationNote?, decisionRecordBlock?, contributorRows].
function decisionRecordBlock(groups: OpportunityGroup[]): ReactElement | false {
  const el = OpportunityBoard({ groups, websiteId: WEBSITE_ID }) as ReactElement;
  const cardContent = (el.props.children as ReactElement[])[1];
  const table = (cardContent.props.children as ReactElement[])[0];
  const tbody = (table.props.children as ReactElement[])[1];
  const fragment = (tbody.props.children as ReactElement[])[0];
  const contributorsRow = (fragment.props.children as (ReactElement | false)[])[1];
  if (!contributorsRow) return false;
  const td = (contributorsRow as ReactElement).props.children as ReactElement;
  const details = td.props.children as ReactElement;
  const innerDiv = (details.props.children as ReactElement[])[1];
  return (innerDiv.props.children as (ReactElement | false)[])[2];
}

// Row: [issue td, pages td, status td, proofLayer td, action td]. Action td's children are
// either the noAutoFixReason span or a div of [...suggestion Links, Review Link].
function actionCellLinks(groups: OpportunityGroup[]): ReactElement[] {
  const el = OpportunityBoard({ groups, websiteId: WEBSITE_ID }) as ReactElement;
  const cardContent = (el.props.children as ReactElement[])[1];
  const table = (cardContent.props.children as ReactElement[])[0];
  const tbody = (table.props.children as ReactElement[])[1];
  const fragment = (tbody.props.children as ReactElement[])[0];
  const row = (fragment.props.children as ReactElement[])[0];
  const actionTd = (row.props.children as ReactElement[])[4];
  const actionDiv = actionTd.props.children as ReactElement;
  // actionDiv's children are [suggestions.map(...) array, Review Link] — flatten since the
  // suggestions list itself arrives as a nested array, not a sibling element.
  return (actionDiv.props.children as (ReactElement | ReactElement[])[]).flat();
}

describe('OpportunityBoard — one-click draft evidence (Phase 2F S3)', () => {
  function singleFindingGroup(overrides: Partial<OpportunityGroup> = {}): OpportunityGroup {
    return {
      key: 'finding:meta_description',
      issueLabel: 'Missing meta descriptions',
      pageCount: 1,
      status: 'found',
      proofLayer: null,
      samplePageUrl: 'https://example.com/',
      severity: 'medium',
      contributors: [
        { id: 'finding_1', agent: 'seo_specialist', ruleId: 'meta_description', pageUrl: 'https://example.com/', evidence: {}, suggestedAction: 'Write one.', limitations: null },
      ],
      ...overrides,
    };
  }

  it('adds the sole contributing Finding id to the Studio link for a single-page opportunity', () => {
    const links = actionCellLinks([singleFindingGroup()]);
    const studioLink = links.find((l) => l.props.children === 'Studio');
    expect(studioLink?.props.href).toContain('sourceFindingId=finding_1');
  });

  it('omits sourceFindingId when the opportunity spans more than one contributing Finding', () => {
    const links = actionCellLinks([
      singleFindingGroup({
        pageCount: 2,
        contributors: [
          { id: 'finding_1', agent: 'seo_specialist', ruleId: 'meta_description', pageUrl: 'https://example.com/', evidence: {}, suggestedAction: 'Write one.', limitations: null },
          { id: 'finding_2', agent: 'seo_specialist', ruleId: 'meta_description', pageUrl: 'https://example.com/other', evidence: {}, suggestedAction: 'Write one.', limitations: null },
        ],
      }),
    ]);
    const studioLink = links.find((l) => l.props.children === 'Studio');
    expect(studioLink?.props.href).not.toContain('sourceFindingId');
  });

  it('renders no Studio link at all for a consolidated group (no ruleId to suggest a channel from), even with exactly one contributor', () => {
    const links = actionCellLinks([
      singleFindingGroup({ key: 'consolidated:seo_geo_missing_structured_data', consolidationReason: 'Both agents found the same issue.' }),
    ]);
    expect(links.find((l) => l.props.children === 'Studio')).toBeUndefined();
  });
});

describe('OpportunityBoard — decision record block', () => {
  it('renders resolution, agreement, final recommendation, and measurement text for a group carrying a decision record', () => {
    const block = decisionRecordBlock([group({ decisionRecord: decisionRecord() })]);
    expect(block).toBeTruthy();

    const text = JSON.stringify(block);
    expect(text).toContain('Resolution:');
    expect(text).toContain('Agreement:');
    expect(text).toContain('Final recommendation:');
    expect(text).toContain('Measurement:');
    expect(text).toContain('seo_geo_missing_structured_data');
    expect(text).toContain('agreed');
  });

  it('renders no decision-record block for a group without one', () => {
    const block = decisionRecordBlock([group()]);
    expect(block).toBeFalsy();
  });

  it('renders no decision-record block when contributors is absent, even with a decision record set', () => {
    const block = decisionRecordBlock([group({ contributors: undefined, decisionRecord: decisionRecord() })]);
    expect(block).toBeFalsy();
  });
});

describe('OpportunityBoard — no-auto-fix reason (Phase 1F)', () => {
  function noAutoFixBlock(groups: OpportunityGroup[]): ReactElement | false {
    const el = OpportunityBoard({ groups, websiteId: WEBSITE_ID }) as ReactElement;
    const cardContent = (el.props.children as ReactElement[])[1];
    const table = (cardContent.props.children as ReactElement[])[0];
    const tbody = (table.props.children as ReactElement[])[1];
    const fragment = (tbody.props.children as ReactElement[])[0];
    const contributorsRow = (fragment.props.children as (ReactElement | false)[])[1];
    if (!contributorsRow) return false;
    const td = (contributorsRow as ReactElement).props.children as ReactElement;
    const details = td.props.children as ReactElement;
    const innerDiv = (details.props.children as ReactElement[])[1];
    return (innerDiv.props.children as (ReactElement | false)[])[0];
  }

  it('renders the real reason for a group classified human-decision-required/informational', () => {
    const block = noAutoFixBlock([
      group({
        consolidationReason: undefined,
        noAutoFixReason: 'Dex can\'t know why this page is down and has no server access to fix it — check the page directly.',
      }),
    ]);
    expect(block).toBeTruthy();
    expect(JSON.stringify(block)).toContain("Dex can't know why this page is down");
  });

  it('renders nothing for a group with a real fix path (no noAutoFixReason set)', () => {
    const block = noAutoFixBlock([group()]);
    expect(block).toBeFalsy();
  });

  it('uses plain punctuation instead of an em dash in the action-cell link (overseer polish, 2026-10-16)', () => {
    const el = OpportunityBoard({
      groups: [group({ consolidationReason: undefined, noAutoFixReason: 'Some reason.' })],
      websiteId: WEBSITE_ID,
    }) as ReactElement;
    const text = JSON.stringify(el, (key, value) => {
      if (key === 'href') return String(value);
      if (key === 'type' && typeof value !== 'string') return '[component]';
      return value;
    });
    expect(text).toContain('No automatic fix. See why.');
    expect(text).not.toContain('No auto-fix — see why');
  });
});

describe('OpportunityBoard — recommendation-derived row (Phase 2G)', () => {
  function recommendationGroup(overrides: Partial<OpportunityGroup> = {}): OpportunityGroup {
    return {
      key: 'recommendation:rec_1',
      issueLabel: 'Pricing moves in the local market',
      pageCount: 1,
      status: 'found',
      proofLayer: null,
      samplePageUrl: '',
      severity: null,
      recommendation: {
        id: 'rec_1', confidenceLabel: 'verified_market_development',
        whyNow: 'A nearby competitor cut prices 10%.', businessRelevance: 'Directly relevant to your market.',
        angle: 'What this means for you',
      },
      ...overrides,
    };
  }

  function mainRow(groups: OpportunityGroup[]): ReactElement {
    const el = OpportunityBoard({ groups, websiteId: WEBSITE_ID }) as ReactElement;
    const cardContent = (el.props.children as ReactElement[])[1];
    const table = (cardContent.props.children as ReactElement[])[0];
    const tbody = (table.props.children as ReactElement[])[1];
    const fragment = (tbody.props.children as ReactElement[])[0];
    return (fragment.props.children as ReactElement[])[0];
  }

  function disclosureRow(groups: OpportunityGroup[]): ReactElement | false {
    const el = OpportunityBoard({ groups, websiteId: WEBSITE_ID }) as ReactElement;
    const cardContent = (el.props.children as ReactElement[])[1];
    const table = (cardContent.props.children as ReactElement[])[0];
    const tbody = (table.props.children as ReactElement[])[1];
    const fragment = (tbody.props.children as ReactElement[])[0];
    return (fragment.props.children as (ReactElement | false)[])[2];
  }

  it('shows a disclosure summary "Evidence and reasoning" for a recommendation group', () => {
    const row = disclosureRow([recommendationGroup()]) as ReactElement;
    const td = row.props.children as ReactElement;
    const details = td.props.children as ReactElement;
    const summary = (details.props.children as ReactElement[])[0];
    expect(summary.props.children).toBe('Evidence and reasoning');
  });

  it('includes whyNow, businessRelevance and angle inside the disclosure', () => {
    const row = disclosureRow([recommendationGroup()]) as ReactElement;
    const td = row.props.children as ReactElement;
    const details = td.props.children as ReactElement;
    const innerDiv = (details.props.children as ReactElement[])[1];
    const text = JSON.stringify(innerDiv.props.children);
    expect(text).toContain('A nearby competitor cut prices 10%');
    expect(text).toContain('Directly relevant to your market');
    expect(text).toContain('What this means for you');
  });

  it('links "Create draft" to Studio with sourceRecommendationId', () => {
    const row = mainRow([recommendationGroup()]);
    const actionTd = (row.props.children as ReactElement[])[4];
    const link = actionTd.props.children as ReactElement;
    expect(link.props.children).toBe('Create draft');
    expect(String(link.props.href)).toContain('sourceRecommendationId=rec_1');
  });
});

// Item 2 (overseer production check, 2026-10-16): an Action-type group's issueLabel is now
// the plain-language summary, with the existing technical term carried separately in
// technicalLabel for the desktop table cell and mobile card to show small underneath it.
describe('OpportunityBoard — plain-language issue label with technical term underneath (item 2)', () => {
  function actionGroup(overrides: Partial<OpportunityGroup> = {}): OpportunityGroup {
    return {
      key: 'action:canonical_fix',
      issueLabel: 'Tell Google which page is the main one',
      technicalLabel: 'Canonical tag fix',
      pageCount: 3,
      status: 'draft_ready',
      proofLayer: 'passed',
      samplePageUrl: 'https://example.com/a',
      severity: null,
      ...overrides,
    };
  }

  it('renders the technical term in the desktop table cell underneath the plain-language issueLabel', () => {
    const el = OpportunityBoard({ groups: [actionGroup()], websiteId: WEBSITE_ID }) as ReactElement;
    const cardContent = (el.props.children as ReactElement[])[1];
    const table = (cardContent.props.children as ReactElement[])[0];
    const tbody = (table.props.children as ReactElement[])[1];
    const fragment = (tbody.props.children as ReactElement[])[0];
    const row = (fragment.props.children as ReactElement[])[0];
    const issueTd = (row.props.children as ReactElement[])[0];
    const [primaryDiv, technicalDiv] = issueTd.props.children as ReactElement[];
    expect((primaryDiv.props.children as unknown[])[0]).toBe('Tell Google which page is the main one');
    expect(technicalDiv.props.children).toBe('Canonical tag fix');
  });

  it('omits the technical term entirely for a group that has none (Finding/consolidated/recommendation groups)', () => {
    const el = OpportunityBoard({ groups: [group()], websiteId: WEBSITE_ID }) as ReactElement;
    const cardContent = (el.props.children as ReactElement[])[1];
    const table = (cardContent.props.children as ReactElement[])[0];
    const tbody = (table.props.children as ReactElement[])[1];
    const fragment = (tbody.props.children as ReactElement[])[0];
    const row = (fragment.props.children as ReactElement[])[0];
    const issueTd = (row.props.children as ReactElement[])[0];
    expect((issueTd.props.children as (ReactElement | false)[])[1]).toBe(undefined);
  });
});

describe('OpportunityBoard — mobile stacked cards (dashboard audit item 9)', () => {
  it('hides the table below md and shows one stacked card per opportunity instead', () => {
    const el = OpportunityBoard({ groups: [group(), group({ key: 'other', issueLabel: 'Other issue' })], websiteId: WEBSITE_ID }) as ReactElement;
    const cardContent = (el.props.children as ReactElement[])[1];
    const [table, mobileCards] = cardContent.props.children as ReactElement[];

    expect(table.props.className).toContain('hidden');
    expect(table.props.className).toContain('md:table');
    expect(mobileCards.props.className).toContain('md:hidden');
    expect((mobileCards.props.children as ReactElement[])).toHaveLength(2);
  });

  it('a mobile card carries the same issue label, status, and action link as its table row', () => {
    const el = OpportunityBoard({ groups: [group()], websiteId: WEBSITE_ID }) as ReactElement;
    const cardContent = (el.props.children as ReactElement[])[1];
    const mobileCards = (cardContent.props.children as ReactElement[])[1];
    const card = (mobileCards.props.children as ReactElement[])[0];
    const rendered = (card.type as (props: unknown) => ReactElement)(card.props);
    // next/link's module object is self-referential and breaks JSON.stringify (see file header
    // comment) -- replace any function/object "type" (the Link component reference itself) with
    // its name only, same purpose as navigating around it in the other helpers above.
    const text = JSON.stringify(rendered, (key, value) => {
      if (key === 'href') return String(value);
      if (key === 'type' && typeof value !== 'string') return '[component]';
      return value;
    });
    expect(text).toContain('Missing structured data (SEO + GEO)');
    expect(text).toContain('Review');
  });
});
