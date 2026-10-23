import { auth } from '@clerk/nextjs/server';
import { IconRail } from '@/components/app-shell/icon-rail';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { getPendingReviewCount } from '@/lib/pending-review-count';

// Single call site for every route layout (dashboard/studio/review/settings) — one real
// pending-review-count query shared by both the desktop rail's badge and the mobile bottom
// nav's badge, instead of duplicating the query per layout.
export async function AppShellNav() {
  const { userId } = auth();
  const pendingReviewCount = userId ? await getPendingReviewCount(userId) : 0;

  return (
    <>
      <IconRail pendingReviewCount={pendingReviewCount} />
      <BottomNav pendingReviewCount={pendingReviewCount} />
    </>
  );
}
