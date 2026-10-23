import type { ReactNode } from 'react';

export interface TodayCardProps {
  websiteId: string;
  /** Real count of status:'pending' Actions — same source as computeDashboardStats().pendingCount. */
  pendingReviewCount: number;
  /** Real count of this week's detected competitor changes — same source CompetitorWatchCard reads. */
  competitorChangeCount: number;
  /** Real count of status:'new' ContentRecommendation rows for this website. */
  postIdeaCount: number;
  /** Pre-rendered AI summary sentence (server component, awaited in page.tsx before this renders). */
  summary: ReactNode;
}
