import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentEvidenceSummary } from './agent-evidence-summary';
import type { AgentEvidenceSummaryRow } from '@/lib/agent-evidence-ledger';

describe('AgentEvidenceSummary', () => {
  afterEach(cleanup);

  it('shows the empty state with no rows', () => {
    render(<AgentEvidenceSummary rows={[]} />);
    expect(screen.getByText('No agent activity recorded yet.')).toBeInTheDocument();
  });

  it('leads with a plain-language phrase and keeps the specialist name small underneath', () => {
    const rows: AgentEvidenceSummaryRow[] = [
      { agent: 'SEO Specialist', detail: 'Checked 12 pages', at: new Date('2026-10-14T10:00:00Z') },
    ];
    render(<AgentEvidenceSummary rows={rows} />);
    expect(screen.getByText('Technical SEO check')).toBeInTheDocument();
    expect(screen.getByText('SEO Specialist')).toBeInTheDocument();
  });

  it('falls back to the raw agent name as the plain phrase for an unrecognized agent', () => {
    const rows: AgentEvidenceSummaryRow[] = [
      { agent: 'Some Future Agent', detail: 'Did something', at: new Date('2026-10-14T10:00:00Z') },
    ];
    render(<AgentEvidenceSummary rows={rows} />);
    expect(screen.getAllByText('Some Future Agent')).toHaveLength(2);
  });
});
