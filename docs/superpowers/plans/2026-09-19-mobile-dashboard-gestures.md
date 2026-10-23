# Mobile Dashboard Gestures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim mobile screen space by auto-hiding the fixed bottom nav on scroll, and add swipe/slide gesture alternatives to three tap-only surfaces (dashboard tabs, the bottom nav itself, the Review queue list) — all additive, no existing tap behavior removed.

**Architecture:** Four independent, additive changes to three existing client components, using the `motion` package (already a dependency) for gesture/spring physics and the existing `dex-glass`/`dex-glass-btn` CSS classes for styling. No new API routes, no new database fields — swipe-to-act calls the same `/api/actions/[actionId]/approve` and `/reject` routes the detail page already posts to.

**Tech Stack:** TypeScript, React (client components), `motion` (Framer Motion) for drag/spring, Tailwind, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-19-mobile-dashboard-gestures-design.md` — implements it exactly.
- Every gesture is additive — existing tap/click behavior must keep working unchanged in every task.
- Springs (via `motion`), never CSS transitions, for anything gesture-driven (drag, swipe) — CSS transitions are fine for the scroll-triggered nav hide (not a drag).
- Velocity/distance commit threshold for swipe-to-act: commit if `velocity > 0.11` (px/ms) OR `distance > revealWidth * 0.4`.
- Respect `prefers-reduced-motion` — skip/shorten animation, never skip the resulting state change.
- Full test suite (`npx vitest run`), `npx tsc --noEmit`, and `npx next build` must stay green after every task.
- Running `next build` corrupts a live `next dev` server's chunk manifest on this machine — restart `npm run dev` afterward if one is running (established this session).
- Desktop nav (icon rail) is untouched — every change here is mobile-only, matching where `BottomNav` and `DashboardTabs`'s swipe area actually render.

---

### Task 1: Auto-hide bottom nav on scroll

**Files:**
- Modify: `src/components/app-shell/bottom-nav.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new exported — internal behavior change only, `BottomNav`'s props/exports unchanged.

- [ ] **Step 1: Write the implementation**

In `src/components/app-shell/bottom-nav.tsx`, add scroll-direction state and a listener. Add after the existing `useState` for `lastWebsiteId` (around line 27):

```tsx
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let ticking = false;

    function handleScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const delta = currentScrollY - lastScrollY;
        if (currentScrollY <= 0) {
          setHidden(false);
        } else if (delta > 10) {
          setHidden(true);
        } else if (delta < 0) {
          setHidden(false);
        }
        lastScrollY = currentScrollY;
        ticking = false;
      });
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
```

Update the `<nav>` element's className (currently `"dex-glass fixed inset-x-0 bottom-0 z-40 flex border-t border-border sm:hidden"`) to add the transform/transition:

```tsx
    <nav
      className={cn(
        'dex-glass fixed inset-x-0 bottom-0 z-40 flex border-t border-border transition-transform duration-200 ease-out sm:hidden',
        hidden ? 'translate-y-full' : 'translate-y-0'
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
```

This requires the `cn` utility already imported at the top of the file (`import { cn } from '@/lib/utils';` — already present) and `useEffect` added to the existing `import { useEffect, useState } from 'react';` line (already imports `useEffect` — check the top of the file; if it only imports `useState`, add `useEffect` to that import).

Reduced motion: add this to `src/app/globals.css`'s existing `@media (prefers-reduced-motion: reduce)` block (search for `.dex-app *,` — there's already a block disabling animations globally via `animation-duration: 0.01ms !important; transition-duration: 0.01ms !important;` on `.dex-app *`, which already covers this new `transition-transform` since `BottomNav` renders inside the `.dex-app` root — no additional CSS needed, verify this in Step 3 rather than assuming).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify reduced-motion coverage**

Run: `grep -n "prefers-reduced-motion" src/app/globals.css` and confirm the existing `.dex-app *` block's selector would apply to `BottomNav`'s rendered `<nav>` element (it renders inside `<div id="dex-app-root" className="dex-app ...">` per `dashboard/layout.tsx` — confirm this wrapper is a real ancestor). If it does NOT cover it for any reason, add a scoped override instead of assuming.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all existing tests pass unchanged (no test file exists for `bottom-nav.tsx` yet — Task 3 adds one, covering this behavior too).

- [ ] **Step 5: Commit**

```bash
git add src/components/app-shell/bottom-nav.tsx
git commit -m "feat: auto-hide mobile bottom nav on scroll down, reveal on scroll up

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

### Task 2: Swipeable dashboard tabs

**Files:**
- Modify: `src/components/dashboard/dashboard-tabs.tsx`
- Test: `src/components/dashboard/dashboard-tabs.test.tsx` (new)

**Interfaces:**
- Consumes: `motion` package's `motion.div`, `PanInfo` type (`import { motion, type PanInfo } from 'motion/react';` — confirm the exact import path by checking how `motion` is imported elsewhere in this codebase first, e.g. `grep -rn "from 'motion" src --include="*.tsx" | grep -v test`; use whatever import path that establishes, don't guess).
- Produces: exported pure function `getSwipeTargetTab(currentIndex: number, offsetX: number, velocityX: number, tabCount: number): number | null` — returns the target tab index to switch to, or `null` if the swipe doesn't qualify. Task 2's own test covers this directly; no other task depends on it.

- [ ] **Step 1: Write the failing test**

Create `src/components/dashboard/dashboard-tabs.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { getSwipeTargetTab } from './dashboard-tabs';

describe('getSwipeTargetTab', () => {
  it('returns the next tab index on a qualifying leftward swipe (finger moves left = next tab)', () => {
    // distance threshold: |offsetX| > 50, velocity threshold: |velocityX| > 0.11 px/ms (500 px/s here, well over)
    expect(getSwipeTargetTab(0, -80, -500, 3)).toBe(1);
  });

  it('returns the previous tab index on a qualifying rightward swipe', () => {
    expect(getSwipeTargetTab(1, 80, 500, 3)).toBe(0);
  });

  it('returns null when the swipe is under both thresholds', () => {
    expect(getSwipeTargetTab(0, -20, -50, 3)).toBeNull();
  });

  it('returns null at the last tab swiping further left (no wraparound)', () => {
    expect(getSwipeTargetTab(2, -80, -500, 3)).toBeNull();
  });

  it('returns null at the first tab swiping further right (no wraparound)', () => {
    expect(getSwipeTargetTab(0, 80, 500, 3)).toBeNull();
  });

  it('qualifies on velocity alone even with a short distance (a fast flick)', () => {
    expect(getSwipeTargetTab(0, -20, -600, 3)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/dashboard-tabs.test.tsx`
Expected: FAIL — `getSwipeTargetTab` is not exported yet.

- [ ] **Step 3: Write the implementation**

First check the real `motion` import path used elsewhere: `grep -rn "from 'motion" src --include="*.tsx" | grep -v test`. If nothing is found (this is the first `motion` usage in a `.tsx` file), use `import { motion, type PanInfo } from 'motion/react';` (the package's own documented React entry point for v13+).

In `src/components/dashboard/dashboard-tabs.tsx`, add the exported pure function (near the top, after the `TABS` const):

```tsx
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
```

(Note: `velocityX` from `motion`'s `PanInfo.velocity.x` is in px/second, not px/ms — the threshold check multiplies `SWIPE_VELOCITY_THRESHOLD` by 1000 to convert. The test cases above pass velocity values already in px/second, e.g. `-500`, matching this.)

Wrap the `<TabsContent>` elements in a `motion.div` handling the pan gesture. Replace the three `<TabsContent value="..." className="mt-4">{...}</TabsContent>` blocks' common wrapper — add a `motion.div` around all three, inside `<Tabs>`:

```tsx
  const currentIndex = TABS.findIndex((t) => t.value === activeTab);

  function handlePanEnd(_event: unknown, info: PanInfo) {
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
      <motion.div drag="x" dragElastic={0.15} dragMomentum={false} onPanEnd={handlePanEnd}>
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
```

`dragElastic={0.15}` gives the rubber-band resistance at the boundaries (motion's built-in elastic drag, equivalent to apple-design's `rubberband()` formula — no need to hand-roll it). `dragMomentum={false}` prevents the content from continuing to slide after release (we handle the tab switch ourselves in `onPanEnd`, not via drag inertia).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/dashboard-tabs.test.tsx`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/dashboard-tabs.tsx src/components/dashboard/dashboard-tabs.test.tsx
git commit -m "feat: swipeable dashboard tabs (Overview/Analytics/Outcomes)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

### Task 3: Bottom nav as a sliding segmented control

**Files:**
- Modify: `src/components/app-shell/bottom-nav.tsx`
- Test: `src/components/app-shell/bottom-nav.test.tsx` (new)

**Interfaces:**
- Consumes: `motion.div` (same import path established in Task 2).
- Produces: nothing new exported.

- [ ] **Step 1: Write the implementation**

In `src/components/app-shell/bottom-nav.tsx`, restructure the `<nav>` internals so the 4 items sit inside one pill track with an animated thumb behind the active item. Replace the current `{navItems.map(...)}` block's wrapper structure:

```tsx
      <div className="dex-glass relative mx-auto flex w-full max-w-sm rounded-full p-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative z-10 flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[11px] font-medium transition-colors',
                isActive ? 'text-accent' : 'text-muted-foreground'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-thumb"
                  className="absolute inset-0 -z-10 rounded-full bg-accent/15"
                  transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                />
              )}
              <item.icon size={22} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
              {item.href === '/review' && pendingReviewCount > 0 && (
                <span
                  className="absolute right-[calc(50%-20px)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground"
                  aria-hidden="true"
                >
                  {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                </span>
              )}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
```

This uses `motion`'s `layoutId` — a `motion.div` sharing the same `layoutId` across renders automatically animates its position/size between where it was and where it now is (this is how the "thumb" slides to the new active item without manually tracking pixel positions). Keep the outer `<nav>` element and its `dex-glass fixed inset-x-0 bottom-0 ...` classes from Task 1 unchanged — only the content inside `<nav>` changes to the pill-track structure above.

Add the `motion` import (same path Task 2 established) to the top of the file.

- [ ] **Step 2: Write the test**

Create `src/components/app-shell/bottom-nav.test.tsx`. This project's established pattern for a `'use client'` component with routing/DOM dependencies (see `src/components/dashboard/scan-stage-breadcrumb.test.tsx` for the exact house pattern — read it first) mocks `next/navigation`'s `usePathname` and asserts on the rendered output. Follow that same pattern:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { BottomNav } from './bottom-nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/review',
}));

describe('BottomNav', () => {
  it('marks the Review item active when the current path matches', () => {
    const result = BottomNav({ pendingReviewCount: 5 });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain('Review');
    // isActive on /review should mean the accent text class is present in that item's tree.
    expect(rendered).toContain('text-accent');
  });

  it('shows the pending review count badge when greater than zero', () => {
    const result = BottomNav({ pendingReviewCount: 5 });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain('5');
  });

  it('caps the displayed badge at 99+', () => {
    const result = BottomNav({ pendingReviewCount: 150 });
    const rendered = JSON.stringify(result);
    expect(rendered).toContain('99+');
  });
});
```

If `BottomNav` cannot be called as a plain function this way (it uses hooks like `useState`/`useEffect` that require a real render environment), instead follow whatever pattern `scan-stage-breadcrumb.test.tsx` actually uses for a hook-using client component — read that file and match it exactly rather than guessing; do not invent a new test-harness pattern for this file.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/components/app-shell/bottom-nav.test.tsx`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-shell/bottom-nav.tsx src/components/app-shell/bottom-nav.test.tsx
git commit -m "feat: bottom nav as a sliding segmented control with animated thumb

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

### Task 4: Swipe-to-act on Review queue rows

**Files:**
- Modify: `src/components/dashboard/review-queue-list.tsx`
- Test: `src/components/dashboard/review-queue-list.test.tsx` (new)

**Interfaces:**
- Consumes: `motion.li` / `PanInfo` (same import path Task 2 established).
- Produces: exported pure function `shouldCommitSwipe(distance: number, velocity: number, revealWidth: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/components/dashboard/review-queue-list.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { shouldCommitSwipe } from './review-queue-list';

describe('shouldCommitSwipe', () => {
  const revealWidth = 140;

  it('commits when distance exceeds 40% of reveal width', () => {
    expect(shouldCommitSwipe(60, 0, revealWidth)).toBe(true);
  });

  it('commits when velocity exceeds the threshold even with a short distance', () => {
    expect(shouldCommitSwipe(10, 200, revealWidth)).toBe(true); // 200 px/s > 110 px/s (0.11 px/ms)
  });

  it('does not commit when both distance and velocity are under threshold', () => {
    expect(shouldCommitSwipe(20, 50, revealWidth)).toBe(false);
  });

  it('treats negative (leftward) distance and velocity the same as positive magnitude', () => {
    expect(shouldCommitSwipe(-60, 0, revealWidth)).toBe(true);
    expect(shouldCommitSwipe(-10, -200, revealWidth)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/review-queue-list.test.tsx`
Expected: FAIL — `shouldCommitSwipe` not exported yet.

- [ ] **Step 3: Write the implementation**

In `src/components/dashboard/review-queue-list.tsx`, add near the top (after the `ReviewQueueListItem` interface):

```tsx
const SWIPE_VELOCITY_THRESHOLD_PX_PER_SEC = 110; // 0.11 px/ms, same threshold used elsewhere this session

export function shouldCommitSwipe(distance: number, velocity: number, revealWidth: number): boolean {
  return Math.abs(distance) > revealWidth * 0.4 || Math.abs(velocity) > SWIPE_VELOCITY_THRESHOLD_PX_PER_SEC;
}
```

Add state for which row is swipe-open, and approve/reject handlers that POST to the existing routes. Add after the existing `searchParams` line:

```tsx
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  async function handleQuickDecision(actionId: string, decision: 'approve' | 'reject') {
    setPendingRowId(actionId);
    try {
      await fetch(`/api/actions/${actionId}/${decision}`, { method: 'POST' });
      // Same routes the detail page already posts to -- on success they redirect server-side
      // for a full page nav, but this is a fetch from a list row, so refresh the list view
      // instead of following that redirect.
      window.location.reload();
    } finally {
      setPendingRowId(null);
    }
  }
```

Replace the `<li key={action.id}>` block's contents with a swipeable wrapper. The `<Link>` stays exactly as-is (tap still opens detail); it now sits inside a `motion.div` that can be dragged to reveal two action buttons behind it:

```tsx
            <li key={action.id} className="relative overflow-hidden rounded-md">
              <div className="dex-glass-btn absolute inset-y-0 right-0 flex" aria-hidden={openRowId !== action.id}>
                <button
                  type="button"
                  disabled={pendingRowId === action.id}
                  onClick={() => handleQuickDecision(action.id, 'reject')}
                  className="flex w-[70px] items-center justify-center bg-destructive/85 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={pendingRowId === action.id}
                  onClick={() => handleQuickDecision(action.id, 'approve')}
                  className="flex w-[70px] items-center justify-center bg-accent/85 text-xs font-medium text-accent-foreground disabled:opacity-50"
                >
                  Approve
                </button>
              </div>
              <motion.div
                drag="x"
                dragConstraints={{ left: -140, right: 0 }}
                dragElastic={0.1}
                animate={{ x: openRowId === action.id ? -140 : 0 }}
                onDragEnd={(_event, info) => {
                  const commit = shouldCommitSwipe(info.offset.x, info.velocity.x, 140);
                  setOpenRowId(commit && info.offset.x < 0 ? action.id : null);
                }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                className="relative bg-background"
              >
                <Link
                  href={hrefFor(action.id)}
                  scroll={false}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(
                    'flex min-h-11 flex-col gap-1 rounded-md border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected
                      ? 'border-[var(--dex-app-border-strong)] bg-muted'
                      : 'border-transparent hover:bg-muted/60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-foreground">{action.pageUrl}</span>
                    {action.guardResult && (
                      <Badge variant={OUTCOME_VARIANT[action.guardResult.outcome] ?? 'secondary'}>
                        {OUTCOME_LABEL[action.guardResult.outcome] ?? action.guardResult.outcome}
                      </Badge>
                    )}
                    {!action.guardResult && action.generationStatus === 'failed' && (
                      <Badge variant="destructive">Draft failed</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(action.createdAt)}</span>
                </Link>
              </motion.div>
            </li>
```

Add the `motion` import (same path established in Task 2) to the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/review-queue-list.test.tsx`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/review-queue-list.tsx src/components/dashboard/review-queue-list.test.tsx
git commit -m "feat: swipe-to-approve/reject on Review queue rows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

### Task 5: Production build, visual verification, and deploy

**Files:** none (verification + deployment only)

- [ ] **Step 1: Full verification**

Run in order: `npx vitest run`, `npx tsc --noEmit`, `npx next build`. All must pass. Restart `npm run dev` afterward if one is running (build corrupts its chunk manifest on this machine).

- [ ] **Step 2: Visual verification on real data**

Use the already-connected `browse` session against the local dev server at 375×812 (mobile). On a real authenticated dashboard page: scroll down and confirm the bottom nav slides out of view, scroll up and confirm it reappears; swipe left/right on the tab content and confirm the active tab changes with rubber-band resistance at the boundaries; confirm the bottom nav renders as one pill track with a sliding highlight behind the active item; on `/review`, swipe a row left and confirm Approve/Reject buttons reveal, tap Approve/Reject on a low-stakes real pending item OR verify the reveal/commit behavior only (don't approve/reject a real customer's draft without the account owner's go-ahead — screenshot the revealed state as evidence instead of completing a real decision unless explicitly told to). Screenshot each, save to `docs/superpowers/evidence/2026-09-17-responsive-release-gate/after/mobile-gestures/` following this session's naming convention.

- [ ] **Step 3: Deploy**

```bash
vercel deploy --prod --yes
```

Confirm the alias: `vercel inspect dex-ai-plum.vercel.app` — printed `id` must match the deployment just created.

- [ ] **Step 4: Record completion**

Append a section to `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md` (matching this session's established per-slice entries): what shipped, commit SHAs, deployment id, and confirmation that all 4 gestures are additive (tap/click paths unchanged).

```bash
git add docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md
git commit -m "docs: record mobile dashboard gestures completion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WXzeifZRz72mB7NvcSTxMU"
```

---

## Self-Review Notes

- **Spec coverage:** A (Task 1), B (Task 2), C (Task 3), D (Task 4), styling (dex-glass reused throughout, no new visual language), testing (each task's own pure-function extraction), deploy (Task 5) — all covered.
- **Placeholder scan:** none — every step has real code, or an explicit instruction to read a named existing file and match its exact pattern rather than guess (Task 3 Step 2's fallback, the `motion` import-path check in Task 2/3/4) — these are deliberate "verify against the real file, don't assume" instructions, not placeholders.
- **Type consistency:** `getSwipeTargetTab`, `shouldCommitSwipe` names and signatures match between their definition and test-import statements across tasks. The `motion` import path is established once (Task 2) and referenced, not re-derived, in Tasks 3-4.
- **Risk flagged for the implementer:** Task 3's test approach (calling a hooks-using client component as a plain function) may not work depending on what `scan-stage-breadcrumb.test.tsx`'s actual pattern turns out to be — the step explicitly says to read that file first and match it, not to force the pattern shown.
