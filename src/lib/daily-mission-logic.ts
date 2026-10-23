export interface UserLoopState {
  activeScans: number;
  pendingActions: number;
}

export interface Mission {
  icon: string;
  title: string;
  description: string;
  cta: string;
  ctaHref: string;
}

export function computeNextMission(state: UserLoopState): Mission {
  if (state.activeScans > 0) {
    return {
      icon: '🔍',
      title: 'Audit in Progress',
      description: 'Follow the latest scan as it runs.',
      cta: 'Watch Feed',
      ctaHref: '#work-feed',
    };
  }

  if (state.pendingActions > 0) {
    return {
      icon: '📋',
      title: `Review ${state.pendingActions} change${state.pendingActions === 1 ? '' : 's'}`,
      description: 'Draft changes are waiting for your decision.',
      cta: 'Open Review Queue',
      ctaHref: '/review',
    };
  }

  return {
    icon: '🚀',
    title: 'Start a New Audit',
    description: 'Run an audit to find the next opportunity.',
    cta: 'New Scan',
    ctaHref: '#scan-control',
  };
}
