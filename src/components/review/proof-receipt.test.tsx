import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReceiptView } from '@/lib/proof-receipt';
import { ProofReceipt } from './proof-receipt';

const receipt: ReceiptView = {
  actionId: 'action_1', snapshot: null, basis: 'current_record', events: [], limitations: [],
  currentRecord: {
    pageUrl: 'https://example.com', actionType: 'meta_description', currentValue: null,
    draftContent: '<script>alert(1)</script>', riskTier: 'low', policyVersion: 'policy_1',
    guard: { outcome: 'pass', reasoning: 'Recorded check', checksRun: [{ check: 'future_check', result: 'pass', detail: '<b>Stored detail</b>' }] },
  },
  outcome: { baseline: null, baselineCapturedAt: null, measured: null, measuredAt: null, availability: 'unavailable' },
};

describe('ProofReceipt', () => {
  it('discloses missing associations and never treats unavailable metrics as zero', () => {
    const html = renderToStaticMarkup(<ProofReceipt receipt={receipt} currentStatus="approved" />);
    expect(html).toContain('Show receipt details');
    expect(html).toContain('show exactly which version of the text these checks ran on');
    expect(html).toContain('GSC row availability unavailable');
    expect(html).toContain('No decision saved yet');
    expect(html).not.toContain('0 clicks');
  });

  it('keeps unknown checks visible and escapes stored text', () => {
    const html = renderToStaticMarkup(<ProofReceipt receipt={receipt} currentStatus="edited" />);
    expect(html).toContain('future_check');
    expect(html).toContain('&lt;b&gt;Stored detail&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Edited content was not rechecked');
  });

  it('distinguishes observed zero from historical metrics', () => {
    const observed: ReceiptView = { ...receipt, outcome: { ...receipt.outcome, availability: 'observed_rows', baseline: { clicks: 0, impressions: 0 }, measured: { clicks: 0, impressions: 0 } } };
    const observedHtml = renderToStaticMarkup(<ProofReceipt receipt={observed} currentStatus="approved" />);
    expect(observedHtml).toContain('Observed GSC rows');
    expect(observedHtml).toContain('&quot;clicks&quot;: 0');
    expect(observedHtml).toContain('&quot;impressions&quot;: 0');
    const historical: ReceiptView = { ...receipt, outcome: { ...observed.outcome, availability: 'historical_unqualified' } };
    const html = renderToStaticMarkup(<ProofReceipt receipt={historical} currentStatus="approved" />);
    expect(html).toContain('Historical values');
    expect(html).toContain('row availability was not recorded');
    expect(html).not.toContain('Observed GSC rows');
  });

  it('shows both saved edit values without substituting the current draft', () => {
    const edited: ReceiptView = { ...receipt, basis: 'saved_snapshot', snapshot: {
      version: 1, actionId: 'action_1', customerId: 'customer_1', clientProfileId: 'profile_1', websiteId: 'website_1',
      ...receipt.currentRecord, preDecisionDraftContent: 'Saved original draft', decidedContent: 'Saved edited text',
      decision: 'edited', actorClerkUserId: 'user_1', decidedAt: '2026-10-11T19:00:00.000Z',
      checkedContent: 'unavailable', provenance: { status: 'unavailable' },
    } };
    const html = renderToStaticMarkup(<ProofReceipt receipt={edited} currentStatus="pending" />);
    expect(html).toContain('Saved original draft');
    expect(html).toContain('Saved edited text');
    expect(html).not.toContain('&lt;script&gt;');
  });
});
