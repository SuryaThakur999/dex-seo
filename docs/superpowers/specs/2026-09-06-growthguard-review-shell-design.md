# GrowthGuard review shell — design

## Problem

A 4-seat council exercise (UX Architect, Growth Hacker, Trend Researcher,
Contrarian — full report published as an artifact this session) analyzed Dex
against Okara.ai and converged, independently, on one finding: Dex's actual
differentiation — a checklist-based, explainable safety gate on every
AI-drafted action — has no visible screen. Three of the four seats named this
as the single highest-leverage gap.

That finding turned out to be half wrong on investigation. The screen
exists: `src/app/review/[actionId]/page.tsx` already renders the real
`GuardResult` data (`checksRun: GuardCheckResult[]`, `reasoning`, `outcome`)
from `src/lib/growth-guard.ts`, per-check, with pass/fail detail sentences.
The council fork that raised the finding never saw this file — only the
dashboard and marketing site were in its context.

What's actually true: `/review` and `/review/[actionId]` are real,
functional, and honest about what GrowthGuard checks — but they're still on
the pre-redesign light theme, with no sidebar navigation at all, disconnected
from the dark coral/amber `.dex-app` shell the dashboard shipped this
session. A user has to already know the `/review` URL or click a small text
link buried in the dashboard's `GuardBreakdown` card — there's no persistent
way to get there.

## What this is not

This is not the scored risk model the strategy document defers until 10
paying customers exist (`docs/superpowers/specs/2026-08-14-dex-ai-strategy-design.md`,
Section 5). `growth-guard.ts` runs five hardcoded checks
(`ai-content-disclosure`, `no-unverifiable-claims`, `no-contradiction`,
`length-format`, `duplicate-risk`) and aggregates pass/flag/block from
hard-fail membership — confirmed by reading the file directly. This work
does not add scoring, weighting, or new check logic. It renders the real
checklist that already runs, honestly, in the shell the rest of the product
now has.

This is also not a redesign of `/settings` (untouched, deliberately —
follow-up candidate, not fixed now), not an onboarding-flow rebuild, not new
backend work, and not an attempt to copy Okara's actual product UI.

## Reference: what Okara's actual dashboard looks like

Okara's marketing site was live-scraped earlier this session. Its logged-in
product was not accessible without an account, but a third-party reviewer's
real, dated test screenshot (tribechat.com, tested live, March 2026) shows
it clearly: a dark terminal-log chat interface ("AI CMO Terminal") — prompt-
style output (`$ Initializing AI CMO...`), a credit counter, a pixel-mascot
icon — not a card/chart dashboard at all. The same review documents it
failing live: a silent credit-limit error mid-operation, the UI still
showing "5 Credits" while blocked, a loading spinner left stuck with zero
explanation.

Two conclusions from this, neither of which changes scope:

1. Dex's card/chart dashboard was never stylistically converging with
   Okara's real product — they're different paradigms. No copying needed.
2. The failure mode just observed firsthand (silent, contradictory, dead
   loading state, no explanation) is the exact opposite of what this work
   is for. It sharpens the reasoning, it doesn't add work.

One real pattern from Okara's **marketing site** (not its app) is worth
translating: the agent-icon row under their hero proves product scope in
one glance. Applied to Dex's own differentiator — checklist rigor, not
agent count — that becomes a compact 5-icon status row for GrowthGuard's
five real checks.

## Design

### Shared icon-rail shell

`src/app/dashboard/layout.tsx` currently inlines the icon-rail sidebar
(logo mark, `NAV_ITEMS` map, active-link styling is absent today — every
link renders identically regardless of current route). Extract this into
`src/components/app-shell/icon-rail.tsx`:

- Same three nav items (`Dashboard`, `Review queue`, `Settings`), same
  Phosphor icons (`SquaresFour`, `ListChecks`, `Gear`).
- New: active-state awareness via `usePathname()` — the current section's
  icon gets the accent treatment (`text-accent bg-muted`) instead of every
  link rendering as plain `text-muted-foreground`. This is a real, small
  UX gap the council's UX seat flagged generically ("settings icon gives no
  visual hint") and is cheap to fix while the rail is already being touched.
- `dashboard/layout.tsx` is rewritten to import and render the shared rail
  instead of inlining it — same visual output, single source of truth.

### `/review` gets a layout, joins the shell

New `src/app/review/layout.tsx`, structurally identical to
`dashboard/layout.tsx` after the extraction above: `.dex-app dark` wrapper +
`<IconRail />` + `{children}`. This is the actual fix for "the explanation
screen is undiscoverable" — it's now one rail-click away from anywhere in
the app, not a text link three clicks deep.

`src/app/review/page.tsx` and `src/app/review/[actionId]/page.tsx` get
restyled to the dark token set already established (`bg-background`,
`text-foreground`, `border-border`, `bg-card`, existing `Badge`/`Card`
components — no new components needed for the base restyle, they already
respond to the `.dex-app dark` scope via CSS variables, same as the
dashboard's cards do).

### GrowthGuard check icons

New export in `src/lib/guard-outcome-ui.ts`:

```typescript
export const CHECK_ICON: Record<string, PhosphorIcon> = {
  'ai-content-disclosure': Fingerprint,
  'no-unverifiable-claims': Scales,
  'no-contradiction': Prohibit,
  'length-format': Ruler,
  'duplicate-risk': Copy,
};
export const CHECK_LABEL: Record<string, string> = {
  'ai-content-disclosure': 'AI disclosure',
  'no-unverifiable-claims': 'Verifiable claims',
  'no-contradiction': 'No contradiction',
  'length-format': 'Length',
  'duplicate-risk': 'Not a duplicate',
};
```

(All five icons confirmed to exist in the installed `@phosphor-icons/react`
package by listing the actual `dist/ssr/` directory, not assumed.)

On `/review/[actionId]`, a compact 5-icon row renders above the existing
detail list, inside the same `GrowthGuard result` card: each check's icon,
muted/outline when it passed, tinted in the outcome's color (amber for a
flag-contributing fail, red for a block-contributing fail) when it didn't.
This is the Okara-inspired proof-of-scope move, aimed at Dex's own
differentiator. The existing detail list stays underneath, now showing
`CHECK_LABEL[check.check]` next to the detail sentence instead of the
sentence alone — currently a user sees "Draft is 180 characters, over the
155-character guidance" with no indication that's the *length* check
specifically; the label makes that explicit.

On `/review` (the queue list), no icon-row change — the existing
per-action outcome `Badge` is sufficient at list-item density; the detail
belongs on the detail page, not the list.

## Testing

`icon-rail.tsx` is presentational with one branch of real logic
(`usePathname()` active-state matching) — a component test isn't
proportionate for a 3-item nav array in this codebase's existing
convention (no component tests exist for `dashboard/layout.tsx` today
either). `CHECK_ICON`/`CHECK_LABEL` are two `Record` lookups — verified by
a unit test asserting all five `growth-guard.ts` check names have both a
label and an icon entry, so a future sixth check added to the checklist
without updating these maps fails a test instead of rendering `undefined`.
Visual verification via the `browse` skill against the dev server, same
pattern as the dashboard rebuild's Task 7, checking both `/review` and
`/review/[actionId]` in both the empty-queue and populated states.
