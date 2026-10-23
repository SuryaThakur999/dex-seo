import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { renderEvidencePdf } from './evidence-pdf';
import type { ReceiptView } from './proof-receipt';

vi.mock('@react-pdf/renderer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@react-pdf/renderer')>();
  return { ...original, renderToBuffer: vi.fn(original.renderToBuffer) };
});

const receipt: ReceiptView = {
  actionId: 'action_1', snapshot: null, basis: 'current_record', events: [], limitations: [],
  currentRecord: {
    pageUrl: 'https://example.com/a', actionType: 'meta_description', currentValue: 'Old text',
    draftContent: 'Current text', riskTier: 'low', policyVersion: 'policy_1',
    guard: { outcome: 'pass', reasoning: 'Recorded reasoning', checksRun: [
      { check: 'future_check', result: 'pass', detail: 'First recorded detail' },
      { check: 'future_check', result: 'fail', detail: 'Second recorded detail' },
    ] },
  },
  outcome: { baseline: null, baselineCapturedAt: null, measured: null, measuredAt: null, availability: 'unavailable' },
};

function documentText(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(documentText).join(' ');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return documentText(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

async function exportText(value: ReceiptView, status: 'approved' | 'edited' = 'approved') {
  const buffer = await renderEvidencePdf({ receipt: value, status, decidedAt: new Date('2026-10-11') });
  expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  expect(buffer.length).toBeGreaterThan(100);
  return documentText(vi.mocked(renderToBuffer).mock.calls[0][0]);
}

describe('renderEvidencePdf', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders unavailable measurements honestly and preserves unknown duplicate checks', async () => {
    const text = await exportText(receipt);
    expect(text).toContain('GSC row availability unavailable');
    expect(text).toContain('Checked-content association unavailable');
    expect(text).toContain('Recorded reasoning');
    expect(text).toContain('First recorded detail');
    expect(text).toContain('Second recorded detail');
    expect(text).toContain('future_check');
    expect(text).not.toContain('28 days');
    expect(text).not.toContain('0 clicks');
  });

  it('keeps observed zero values distinct from missing data', async () => {
    const text = await exportText({ ...receipt, outcome: { ...receipt.outcome,
      availability: 'observed_rows', baseline: { clicks: 0, impressions: 0, ctr: 0 },
      measured: { clicks: 0, impressions: 0, ctr: 0 },
    } });
    expect(text).toContain('Observed GSC rows');
    expect(text).toContain('"clicks": 0');
    expect(text).toContain('"impressions": 0');
    expect(text).not.toContain('GSC row availability unavailable');
  });

  it('labels historical values without claiming row availability or improvement', async () => {
    const text = await exportText({ ...receipt, outcome: { ...receipt.outcome,
      availability: 'historical_unqualified', baseline: { clicks: 2 }, measured: { clicks: 4 },
    } });
    expect(text).toContain('Historical values; row availability was not recorded');
    expect(text).not.toContain('Observed GSC rows');
    expect(text).not.toContain('+100');
  });

  it('exports saved original and edited content after the current record changes', async () => {
    const text = await exportText({ ...receipt, basis: 'saved_snapshot', snapshot: {
      version: 1, actionId: 'action_1', customerId: 'customer_1', clientProfileId: 'profile_1', websiteId: 'website_1',
      ...receipt.currentRecord, preDecisionDraftContent: 'Original saved draft', decidedContent: 'Saved edited content',
      decision: 'edited', actorClerkUserId: 'user_1', decidedAt: '2026-10-10T12:00:00.000Z',
      checkedContent: 'unavailable', provenance: { status: 'unavailable' },
    } }, 'edited');
    expect(text).toContain('Original saved draft');
    expect(text).toContain('Saved edited content');
    expect(text).toContain('2026-10-10T12:00:00.000Z');
    expect(text).toContain('Edited content was not rechecked');
    expect(text).not.toContain('Current text');
    expect(text).toContain('Apply approved changes manually');
  });

  it('renders stored markup and special characters as text', async () => {
    const text = await exportText({ ...receipt, currentRecord: { ...receipt.currentRecord,
      draftContent: '<script>alert("Grüße & café")</script>',
    }, limitations: ['Stored limitation'] });
    expect(text).toContain('<script>alert("Grüße & café")</script>');
    expect(text).toContain('Stored limitation');
  });
});
