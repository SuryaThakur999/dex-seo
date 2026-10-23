import { describe, expect, it } from 'vitest';
import { computeNextMission } from './daily-mission-logic';

describe('computeNextMission', () => {
  it('points to the work feed while a scan is active, even with pending actions', () => {
    expect(computeNextMission({ activeScans: 1, pendingActions: 2 })).toEqual({
      icon: '🔍',
      title: 'Audit in Progress',
      description: 'Follow the latest scan as it runs.',
      cta: 'Watch Feed',
      ctaHref: '#work-feed',
    });
  });

  it('uses a singular title for one pending action, with no duplicate count wording', () => {
    expect(computeNextMission({ activeScans: 0, pendingActions: 1 })).toEqual({
      icon: '📋',
      title: 'Review 1 change',
      description: 'Draft changes are waiting for your decision.',
      cta: 'Open Review Queue',
      ctaHref: '/review',
    });
  });

  it('uses a plural title for multiple pending actions', () => {
    expect(computeNextMission({ activeScans: 0, pendingActions: 3 })).toEqual({
      icon: '📋',
      title: 'Review 3 changes',
      description: 'Draft changes are waiting for your decision.',
      cta: 'Open Review Queue',
      ctaHref: '/review',
    });
  });

  it('points to scan controls when there is no active work', () => {
    expect(computeNextMission({ activeScans: 0, pendingActions: 0 })).toEqual({
      icon: '🚀',
      title: 'Start a New Audit',
      description: 'Run an audit to find the next opportunity.',
      cta: 'New Scan',
      ctaHref: '#scan-control',
    });
  });
});
