import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { ActionDetail, ACTION_TYPE_LABEL, type ActionDetailData } from './action-detail';

// Matches the project's existing convention for hookless function components
// (see scan-stage-breadcrumb.test.tsx / seo-findings-panel.test.tsx): call the component as a
// plain function and inspect the returned tree via JSON.stringify rather than
// @testing-library/react, which this repo doesn't use.
function render(action: ActionDetailData): string {
  return JSON.stringify(ActionDetail({ action, revision: 'revision_1' }) as ReactElement);
}

function baseAction(overrides: Partial<ActionDetailData>): ActionDetailData {
  return {
    id: 'action_1',
    actionType: 'meta_description',
    pageUrl: 'https://example.com/pricing',
    currentValue: 'Old description',
    draftContent: 'New description',
    status: 'approved',
    riskTier: 'low',
    generationStatus: 'succeeded',
    generationError: null,
    createdAt: new Date('2026-09-25T00:00:00Z'),
    decidedAt: new Date('2026-09-25T01:00:00Z'),
    outcomeMeasuredAt: null,
    guardResult: { outcome: 'pass', reasoning: 'All checks passed.', checksRun: [] },
    ...overrides,
  };
}

describe('ActionDetail — actionType-aware copy (Phase 1F)', () => {
  it('renders meta_description copy: heading, AI-disclosure wording, SERP preview shown', () => {
    const html = render(baseAction({ actionType: 'meta_description' }));
    expect(html).toContain('Meta description change');
    expect(html).toContain('drafted by AI');
    expect(html).toContain('Google preview');
    expect(html).toContain("Copy this into your site's meta description field");
  });

  it('renders canonical_fix copy: its own heading, honest non-AI disclosure, no SERP preview', () => {
    const html = render(baseAction({ actionType: 'canonical_fix', currentValue: null, draftContent: '<link rel="canonical" href="https://example.com/pricing">' }));
    expect(html).toContain('Canonical tag fix');
    expect(html).toContain('deterministic code, not an AI model');
    expect(html).not.toContain('drafted by AI');
    expect(html).not.toContain('Google preview');
    expect(html).toContain('<head>');
  });

  it('falls back to meta_description copy for an unrecognized actionType, rather than rendering nothing', () => {
    const html = render(baseAction({ actionType: 'some_future_type' }));
    expect(html).toContain('Meta description change');
  });

  it('renders structured_data_fix copy: its own heading, no SERP preview', () => {
    const html = render(
      baseAction({
        actionType: 'structured_data_fix',
        currentValue: null,
        draftContent: '<script type="application/ld+json">{"@type":"WebPage"}</script>',
      })
    );
    expect(html).toContain('Structured data fix');
    expect(html).toContain('deterministic code, not an AI model');
    expect(html).not.toContain('Google preview');
  });

  it('renders entity_markup_fix copy: its own heading, references the homepage, no SERP preview', () => {
    const html = render(
      baseAction({
        actionType: 'entity_markup_fix',
        currentValue: null,
        draftContent: '<script type="application/ld+json">{"@type":"Organization"}</script>',
      })
    );
    expect(html).toContain('Entity markup fix');
    expect(html).toContain('homepage');
    expect(html).not.toContain('Google preview');
  });

  it('renders restricted_wording_fix copy: its own heading, honest AI disclosure (this path IS LLM-generated), no SERP preview', () => {
    const html = render(
      baseAction({
        actionType: 'restricted_wording_fix',
        currentValue: 'We offer guaranteed results',
        draftContent: 'We offer strong results',
      })
    );
    expect(html).toContain('Restricted wording fix');
    expect(html).toContain('drafted by AI');
    expect(html).not.toContain('Google preview');
  });

  it('renders internal_link_fix copy: its own heading, explains the edit happens on OTHER pages, no SERP preview', () => {
    const html = render(
      baseAction({
        actionType: 'internal_link_fix',
        currentValue: null,
        draftContent: '/blog/guide | our full guide',
      })
    );
    expect(html).toContain('Internal link suggestion');
    expect(html).toContain('another page on your site');
    expect(html).not.toContain('Google preview');
  });

  it('renders internal_link_fix suggestions as a real link list, not raw pipe text', () => {
    const html = render(
      baseAction({
        actionType: 'internal_link_fix',
        currentValue: null,
        draftContent: '/blog/guide | our full guide\nhttps://example.com/pricing | see pricing',
      })
    );
    expect(html).toContain('our full guide');
    expect(html).toContain('/blog/guide');
    expect(html).toContain('see pricing');
    expect(html).toContain('https://example.com/pricing');
    // The raw stored format still appears once, in the separate "copy this to apply" code
    // block further down -- that's the literal text the customer copies, a different purpose
    // from the "What changes" section this fix targets. Assert the link list itself exists.
    expect(html).toContain('"aria-label":"Suggested internal links"');
    expect(html).toContain('"type":"a"');
  });

  it('falls back to the plain diff view for internal_link_fix when nothing was relevant', () => {
    const html = render(
      baseAction({
        actionType: 'internal_link_fix',
        currentValue: null,
        draftContent: 'No existing pages are topically relevant to this one.',
      })
    );
    expect(html).toContain('No existing pages are topically relevant to this one.');
  });
});

// Issue 1 (live-review-ux-fixes): the review queue list's fix-type badge reuses this same
// heading text for its label, rather than a second, hand-maintained string table that could
// drift from the detail page's own heading.
describe('ACTION_TYPE_LABEL', () => {
  it('matches the detail page heading for every known actionType, one source of truth', () => {
    expect(ACTION_TYPE_LABEL).toEqual({
      meta_description: 'Meta description change',
      canonical_fix: 'Canonical tag fix',
      structured_data_fix: 'Structured data fix',
      entity_markup_fix: 'Entity markup fix',
      restricted_wording_fix: 'Restricted wording fix',
      internal_link_fix: 'Internal link suggestion',
    });
  });
});

describe('ActionDetail receipt disclosures', () => {
  it('does not certify current or edited bytes from an unbound guard result', () => {
    const html = render(baseAction({ status: 'edited' }));
    expect(html).toContain('show exactly which version of the text these checks ran on');
    expect(html).toContain('Your edited version was not rechecked');
    expect(html).not.toContain('Draft passed ProofLayer');
    expect(html).not.toContain('check of the original AI draft');
  });

  it('states the permanent manual-apply model for every supported type', () => {
    for (const actionType of Object.keys(ACTION_TYPE_LABEL)) {
      const html = render(baseAction({ actionType }));
      expect(html).toContain('Dex does not change your website');
      expect(html).not.toContain('in this version');
    }
  });

  it('preserves duplicate unknown checks and gives the edit disclosure a keyboard focus target', () => {
    const html = render(baseAction({ status: 'pending', guardResult: {
      outcome: 'pass', reasoning: 'Recorded result', checksRun: [
        { check: 'future_check', result: 'pass', detail: 'First result' },
        { check: 'future_check', result: 'fail', detail: 'Second result' },
      ],
    } }));
    expect(html).toContain('First result');
    expect(html).toContain('Second result');
    expect(html).toContain('future_check-0');
    expect(html).toContain('future_check-1');
    expect(html).toContain('min-h-11');
    expect(html).toContain('focus-visible:ring-2');
  });
});
