import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { SeoFindingsPanel, type SeoFinding } from './seo-findings-panel';

const WEBSITE_ID = 'site_1';

function finding(overrides: Partial<SeoFinding> = {}): SeoFinding {
  return {
    id: 'find_1',
    pageUrl: 'https://example.com/pricing',
    ruleId: 'missing_canonical',
    severity: 'medium',
    suggestedAction: 'Add a canonical tag.',
    confidence: 'high',
    limitations: null,
    ...overrides,
  };
}

// Row shape: <div>[ <div>[pageUrl, suggestedAction, limitations?] </div>, <div>[confidence?, studioLinksArray, badge]</div> ]
// `.flat()` because `{suggestions.map(...)}` stays as one nested array child in the raw
// element tree (React only flattens it while actually rendering to DOM).
function rowActionChildren(row: ReactElement): unknown[] {
  return ((row.props.children as ReactElement[])[1].props.children as unknown[]).flat();
}

describe('SeoFindingsPanel', () => {
  it('renders nothing when there are no findings', () => {
    expect(SeoFindingsPanel({ findings: [], websiteId: WEBSITE_ID })).toBeNull();
  });

  it('renders a card when findings are present', () => {
    const el = SeoFindingsPanel({ findings: [finding()], websiteId: WEBSITE_ID });
    expect(el).not.toBeNull();
  });

  it('caps the rendered list at the display limit and notes the overflow count', () => {
    const many = Array.from({ length: 9 }, (_, i) => finding({ id: `find_${i}`, pageUrl: `https://example.com/page-${i}` }));
    const el = SeoFindingsPanel({ findings: many, websiteId: WEBSITE_ID }) as ReactElement;
    const content = (el.props.children as ReactElement[])[1] as ReactElement;
    const rows = content.props.children[0];
    expect(rows).toHaveLength(6);
    const overflowNote = content.props.children[1];
    expect(overflowNote.props.children.join('')).toContain('+3 more finding');
  });

  it('shows a Studio content link for zero_internal_links — a real content angle', () => {
    const el = SeoFindingsPanel({
      findings: [finding({ ruleId: 'zero_internal_links', severity: 'medium' })],
      websiteId: WEBSITE_ID,
    }) as ReactElement;
    const content = (el.props.children as ReactElement[])[1] as ReactElement;
    const row = (content.props.children[0] as ReactElement[])[0];
    const actionChildren = rowActionChildren(row);
    const studioLink = actionChildren.find((c) => (c as ReactElement)?.props?.href?.includes('/studio')) as ReactElement | undefined;
    expect(studioLink).toBeDefined();
    expect(studioLink!.props.href).toContain(`websiteId=${WEBSITE_ID}`);
    expect(studioLink!.props.href).toContain('platform=linkedin');
  });

  it('shows no Studio link for a pure markup fix — not every SEO issue needs a social post', () => {
    const el = SeoFindingsPanel({
      findings: [finding({ ruleId: 'missing_canonical' })],
      websiteId: WEBSITE_ID,
    }) as ReactElement;
    const content = (el.props.children as ReactElement[])[1] as ReactElement;
    const row = (content.props.children[0] as ReactElement[])[0];
    const actionChildren = rowActionChildren(row);
    const studioLink = actionChildren.find((c) => (c as ReactElement)?.props?.href?.includes('/studio'));
    expect(studioLink).toBeUndefined();
  });

  it('surfaces a non-high confidence label instead of silently dropping it', () => {
    const el = SeoFindingsPanel({
      findings: [finding({ confidence: 'medium' })],
      websiteId: WEBSITE_ID,
    }) as ReactElement;
    const content = (el.props.children as ReactElement[])[1] as ReactElement;
    const row = (content.props.children[0] as ReactElement[])[0];
    const actionChildren = rowActionChildren(row);
    const confidenceSpan = actionChildren.find((c) => (c as ReactElement)?.props?.title?.includes('Lower-confidence')) as ReactElement;
    expect(confidenceSpan).toBeDefined();
    expect((confidenceSpan.props.children as unknown[]).join('')).toBe('medium confidence');
  });

  it('surfaces limitations text instead of silently dropping it', () => {
    const el = SeoFindingsPanel({
      findings: [finding({ limitations: 'A non-self canonical can be intentional.' })],
      websiteId: WEBSITE_ID,
    }) as ReactElement;
    const content = (el.props.children as ReactElement[])[1] as ReactElement;
    const row = (content.props.children[0] as ReactElement[])[0] as ReactElement;
    const textBlock = (row.props.children as ReactElement[])[0];
    expect(JSON.stringify(textBlock)).toContain('A non-self canonical can be intentional.');
  });
});
