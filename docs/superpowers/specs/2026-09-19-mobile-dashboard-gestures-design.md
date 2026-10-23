# Mobile dashboard: auto-hide nav + gesture interactions

Design doc, brainstormed and approved 2026-09-19. User reported the mobile bottom nav (`BottomNav`, `fixed inset-x-0 bottom-0`) permanently consumes ~80px (~10%) of a 375×812 viewport, leaving less room for actual dashboard content than a "premium" native app would. Also asked for swipe/slide interactions in three places instead of tap-only. Reference site (`sceneai.art/landing-pages?category=onboarding+mobile+app`) turned out to be a paywalled gallery of AI-generated mockup videos with regeneration prompts, not a component library — treated as visual-mood reference only; components stay on this project's existing shadcn/Radix/skiper-ui stack.

## Scope — four pieces, one cohesive theme

### A. Auto-hide bottom nav on scroll

**File:** `src/components/app-shell/bottom-nav.tsx`

Add scroll-direction tracking: a `useEffect` scroll listener (passive, `requestAnimationFrame`-throttled) comparing the current `scrollY` to the last recorded one. Scrolling down past a 10px threshold (avoids flicker on tiny scrolls/rubber-band bounce) sets `hidden = true`; any upward scroll delta sets `hidden = false` immediately. Force `hidden = false` when `scrollY <= 0` (top) so the nav is never hidden on initial page load.

Apply `translate-y-full` (Tailwind) when hidden, `translate-y-0` when visible, with a CSS `transition-transform duration-200 ease-out` (matches emil-design-eng's 150-250ms dropdown/nav guidance) — this responds to a scroll event, not a drag gesture, so a plain CSS transition is correct here (springs are for gesture-driven interactions, per apple-design's own distinction).

Respect `prefers-reduced-motion`: skip the transition (instant show/hide) rather than animating, matching the existing pattern already used elsewhere in this codebase (`globals.css`'s reduced-motion block).

### B. Swipeable dashboard tabs

**File:** `src/components/dashboard/dashboard-tabs.tsx`

Wrap the `TabsContent` area in a `motion.div` (the `motion` package, already a dependency — no new install) with `onPanEnd` (or `drag="x"` with `dragConstraints`) detecting a horizontal swipe past a velocity/distance threshold (reuse apple-design's `0.11` velocity-or-distance rule already documented for this codebase's own skill references). A qualifying swipe calls the existing `handleChange(nextOrPrevTabValue)` — the exact same function tapping a `TabsTrigger` already calls, so URL sync and everything downstream is unchanged.

Rubber-band resistance (apple-design's `rubberband()` formula) when swiping past the first tab (left) or last tab (right) — no hard stop, no wraparound.

### C. Bottom nav as a sliding segmented control

**File:** `src/components/app-shell/bottom-nav.tsx`

Visual rework only — the 4 nav items (`Mission`/`Studio`/`Review`/`Settings`) move from independent icons into one `dex-glass` pill-shaped track. A `motion.div` "thumb" (rounded highlight, `bg-accent/20` or similar, matching existing token usage) sits positioned behind the active item and animates to the tapped or swiped-to item's position via a spring (`type: 'spring', bounce: 0, duration: 0.3` — critically damped, no overshoot, per apple-design's default for non-momentum UI transitions), not a CSS transition, so a rapid second tap mid-animation redirects smoothly instead of queuing.

Tap-to-select behavior is unchanged (same `Link` elements, same active-state logic) — only the container markup and the addition of the animated thumb element change.

### D. Swipe-to-act on Review queue rows

**File:** `src/components/dashboard/review-queue-list.tsx`

Each row gets a `motion.li` with `drag="x"`, `dragConstraints={{ left: -140, right: 0 }}` (enough travel to reveal two ~64px action buttons), revealing Approve/Reject buttons underneath as the row drags left. Release logic: apple-design's momentum-projection rule — commit (snap fully open) if velocity exceeds the `0.11` threshold OR drag distance exceeds ~40% of the reveal width, otherwise spring back closed. Approve/Reject buttons call the same handlers the existing tap-opens-detail-then-approve flow already uses server-side (no new API route) — this is a UI-layer shortcut to the same mutation, not a new capability.

Tapping the row body (not the revealed actions) still opens `/review/[actionId]` exactly as today.

## Styling

All new/changed surfaces (segmented-control track, swipe-action buttons, any new chrome) use the existing `dex-glass` / `dex-glass-btn` classes shipped this session — same accent tint, same `prefers-reduced-transparency` fallback already built into both. No new visual language introduced beyond what's already live.

## Testing

- `bottom-nav.tsx`: no existing test file — this is a `'use client'` component with scroll/DOM-dependent behavior; the project's established pattern for this class of component (see `seo-findings-panel.test.tsx`) is an element-tree-walk test asserting the hidden/visible class toggles correctly for given mock scroll deltas, not a full browser test.
- `dashboard-tabs.tsx`: assert `handleChange` fires with the correct adjacent tab value on a simulated qualifying swipe, and does NOT fire on a sub-threshold swipe or at a boundary (first tab swiping further left, etc.).
- `review-queue-list.tsx`: assert the reveal-commit threshold logic (velocity OR distance) as a pure function, decoupled from the actual drag gesture — extract `shouldCommitSwipe(distance, velocity, revealWidth): boolean` so it's unit-testable without simulating real pointer events.
- Full suite (`vitest run`), `tsc --noEmit`, `next build` stay green throughout.
- Visual verification on real authenticated mobile viewport (375×812) via the browser session already in use this session, screenshotted before/after per this session's established evidence convention.

## Out of scope

- No changes to desktop nav (icon rail) — this is mobile-only, matching where the complaint and the fixed bottom nav both live.
- No new API routes or database changes — every gesture calls an already-existing handler/mutation.
- Swipe-to-act does not replace the tap-to-open-detail flow; it's an additive shortcut for the two most common decisions (approve/reject), matching the design's own framing ("slide buttons options rather than clicking" — an alternative, not a replacement).
