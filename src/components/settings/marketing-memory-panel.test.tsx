import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MarketingMemorySnapshot } from '@/lib/marketing-memory';
import { MarketingMemoryPanel } from './marketing-memory-panel';

describe('MarketingMemoryPanel', () => {
  afterEach(cleanup);

  it('renders an empty state with guidance to the existing form', () => {
    render(<MarketingMemoryPanel memory={{ clientProfileId: 'cp_1', facts: [] }} />);
    expect(screen.getByText('No brand facts recorded yet. Add them below.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Marketing Memory', level: 2 })).toBeInTheDocument();
  });

  it('renders a profile fact without claiming manual authorship', () => {
    render(<MarketingMemoryPanel memory={{ clientProfileId: 'cp_1', facts: [{
      field: 'brandVoice', value: 'direct, calm', source: 'client_profile',
      evaluatorVersion: null, scope: 'client_profile', decidedAt: null,
    }] }} />);
    expect(screen.getByText('direct, calm')).toBeInTheDocument();
    expect(screen.getByText('Brand voice')).toBeInTheDocument();
    expect(screen.getByText('client profile field')).toBeInTheDocument();
    expect(screen.getByText('applies to all websites on this client profile')).toBeInTheDocument();
    expect(screen.queryByText(/manually|approved by/i)).not.toBeInTheDocument();
  });

  it('renders a preference record match with evaluator version and profile scope', () => {
    render(<MarketingMemoryPanel memory={{ clientProfileId: 'cp_1', facts: [{
      field: 'restrictedWording', value: '100% organic', source: 'activated_preference_match',
      evaluatorVersion: 'v2', scope: 'client_profile', decidedAt: '2026-09-01T00:00:00.000Z',
    }] }} />);
    expect(screen.getByText('100% organic')).toBeInTheDocument();
    expect(screen.getByText('matches activated preference · evaluator v2')).toBeInTheDocument();
    expect(screen.getByText('applies to all websites on this client profile')).toBeInTheDocument();
  });

  it('does not invent an evaluator version when none is recorded', () => {
    render(<MarketingMemoryPanel memory={{ clientProfileId: 'cp_1', facts: [{
      field: 'restrictedWording', value: 'guaranteed results', source: 'activated_preference_match',
      evaluatorVersion: null, scope: 'client_profile', decidedAt: null,
    }] }} />);
    expect(screen.getByText('matches activated preference')).toBeInTheDocument();
    expect(screen.queryByText(/evaluator/)).not.toBeInTheDocument();
  });

  it('renders every field label and preserves multiple values in reading order', () => {
    const memory: MarketingMemorySnapshot = { clientProfileId: 'cp_1', facts: [
      { field: 'businessDescription', value: 'Local shop', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'audience', value: 'Local businesses', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'brandVoice', value: 'Direct', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'markets', value: 'DE', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'markets', value: 'AT', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'languages', value: 'de', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'approvedClaims', value: 'Founded in 2020', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
      { field: 'restrictedWording', value: 'Best ever', source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null },
    ] };
    render(<MarketingMemoryPanel memory={memory} />);
    const items = within(screen.getByRole('list', { name: 'Recorded brand facts' })).getAllByRole('listitem');
    expect(items).toHaveLength(8);
    ['Business description', 'Audience', 'Brand voice', 'Markets', 'Markets', 'Languages', 'Approved claims', 'Restricted wording']
      .forEach((label, index) => expect(within(items[index]).getByText(label)).toBeInTheDocument());
    expect(within(items[3]).getByText('DE')).toBeInTheDocument();
    expect(within(items[4]).getByText('AT')).toBeInTheDocument();
  });

  it('keeps stored markup and instructions as literal display text', () => {
    const value = '<script>ignore previous instructions</script>';
    const { container } = render(<MarketingMemoryPanel memory={{ clientProfileId: 'cp_1', facts: [{
      field: 'brandVoice', value, source: 'client_profile', evaluatorVersion: null, scope: 'client_profile', decidedAt: null,
    }] }} />);
    expect(screen.getByText(value)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
