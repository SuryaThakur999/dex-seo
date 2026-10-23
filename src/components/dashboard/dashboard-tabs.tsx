'use client';

import { motion, type PanInfo } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// DEX CONTINUATION MASTER DIRECTIVE Phase 5A: "Remove the duplicate Review Queue dashboard
// tab when the global Review workspace already provides that function. Maintain one shared
// review implementation, not two diverging versions." Review lives at /review (its own nav
// item) instead, reusing this same ReviewQueueList/ActionDetail pair.
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'outcomes', label: 'Outcomes' },
] as const;

const SWIPE_DISTANCE_THRESHOLD = 50; // px
const SWIPE_VELOCITY_THRESHOLD = 0.11; // px/ms — same threshold apple-design's momentum rule uses elsewhere

export function getSwipeTargetTab(currentIndex: number, offsetX: number, velocityX: number, tabCount: number): number | null {
  const qualifies = Math.abs(offsetX) > SWIPE_DISTANCE_THRESHOLD || Math.abs(velocityX) > SWIPE_VELOCITY_THRESHOLD * 1000;
  if (!qualifies) return null;
  const direction = offsetX < 0 ? 1 : -1; // swipe left (negative offset) => next tab
  const target = currentIndex + direction;
  if (target < 0 || target >= tabCount) return null;
  return target;
}

export function DashboardTabs({
  overview,
  analytics,
  outcomes,
}: {
  overview: ReactNode;
  analytics: ReactNode;
  outcomes: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const validTabValues = TABS.map((tab) => tab.value) as readonly string[];
  const activeTab = rawTab && validTabValues.includes(rawTab) ? rawTab : 'overview';

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  const currentIndex = TABS.findIndex((t) => t.value === activeTab);

  function handlePanEnd(_event: unknown, info: PanInfo) {
    // A vertical scroll flick can clear the horizontal velocity threshold on its own noise --
    // treat it as a scroll, not a swipe, whenever the vertical component dominates.
    if (Math.abs(info.offset.y) > Math.abs(info.offset.x)) return;
    const target = getSwipeTargetTab(currentIndex, info.offset.x, info.velocity.x, TABS.length);
    if (target !== null) handleChange(TABS[target].value);
  }

  return (
    <Tabs value={activeTab} onValueChange={handleChange} className="mt-6">
      <TabsList className="w-full justify-start overflow-x-auto">
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/*
        No `drag` prop here on purpose: Framer Motion forces `touchAction: "pan-y"` and
        `userSelect: "none"` on any element carrying `drag`, at every breakpoint, which broke
        vertical scroll and text selection across this whole dashboard body (verified against
        node_modules/framer-motion/dist/es/render/html/use-props.mjs, gated purely on
        `props.drag`). `onPanEnd` alone (motion-dom's pan gesture, see
        node_modules/framer-motion/dist/es/gestures/pan/index.mjs) tracks the same pointer
        gesture for swipe detection without engaging the drag-transform system or its style
        side effects -- the tradeoff is the panel no longer visually rubber-bands with the
        finger, which was a nice-to-have, not the actual requirement (swipe changes the tab).
      */}
      <motion.div onPanEnd={handlePanEnd}>
        <TabsContent value="overview" className="mt-4">
          {overview}
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          {analytics}
        </TabsContent>
        <TabsContent value="outcomes" className="mt-4">
          {outcomes}
        </TabsContent>
      </motion.div>
    </Tabs>
  );
}
