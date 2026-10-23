# Dex design brief

Distills the six mandatory design skills (`impeccable`, `apple-design`, `emil-design-eng`, `ui-ux-pro-max`, `ui-styling`, `soft-skill`) into Dex-specific rules. Full tier definitions: `hive/LESSONS.md` HARD RULE section. Layout and screen content: `docs/superpowers/specs/dex-precision-mission-control-visual-contract.md`.

## Precedence order

1. AI Rules 1, 2, 7: no fake proof, no invented facts, redesigns additive only.
2. This brief + visual contract + `globals.css` tokens below. Win over any skill's font/color/icon/spacing preference.
3. `impeccable` (quality bar, detector). 4. `apple-design` (hierarchy, clarity, restraint). 5. `emil-design-eng` (motion, interaction craft). 6. `ui-ux-pro-max` (UX patterns, accessibility). 7. `ui-styling` (shadcn/Radix/Tailwind implementation).
8. `soft-skill`, marketing surfaces only, never the signed-in app, never overriding tokens below.

## Tokens (`src/app/globals.css`)

**Fonts:** Fira Sans (400/500/600) for interface text, Fira Code (400/500/600) for monospace/terminal surfaces, system-ui fallback. Never swap in a `soft-skill`-suggested display face (Geist, Clash Display, etc.).

**Radius:** base `--radius: 0.5rem`. Scale: sm `calc(radius - 4px)`, md `calc(radius - 2px)`, lg `radius`, xl `calc(radius + 4px)`. No squircle (`rounded-[2rem]`) or `soft-skill` double-bezel nesting: restrained 1px borders and surface tint, not stacked shells.

**Color, dark app (`html.dark .dex-app`):** bg `#111310`, fg `#F1EBDD`, card `#1A1D18`, border (hairline only) `#34392F`, input/border-strong `#4A5142`, accent `#FF965A` (coral, foreground black), destructive `#ED9290` (foreground black), success `#A8C98A`, warning `#E8C16A`, danger `#ED9290`. Chart series (fixed order, never cycled): blue `#3987e5`, orange `#d95926`, aqua `#199e70`, yellow `#c98500`, magenta `#d55181`, green `#008300`.

**Color, light app (`html.light .dex-app`):** bg `#FAF8F3` (warm off-white), fg `#1C1A15`, card `#FFFFFF`, border `#E5E0D4`, input `#C9C2AE`, accent `#C2410C` (darker than dark mode's, foreground white). Chart series re-stepped per theme; three slots read below 3:1 contrast, so charts always carry a direct-label legend, never color-only identity.

**Marketing (`.dex-marketing`, public homepage only):** bg `#0b0b0f`, elevated `#15151b` / `#1d1d24`, text `#f4f4f6` / `#9a9aa5` / `#5a5a66`, accent `#ff4d2e` / `#ffb020`, border `#232329`.

**Glass:** `.dex-glass` = `color-mix(in srgb, var(--card) 82%, transparent)` + `blur(20px) saturate(180%)`, falls back to solid `--card` under `prefers-reduced-transparency`. Floating/sticky chrome only (nav, overlays), never on scrolling content, never two translucent layers stacked.

**Motion:** `stat-card-in` keyframe, 240ms, `cubic-bezier(0.16, 1, 0.3, 1)`. Default for entrances/dropdowns: 150-250ms `ease-out` or `cubic-bezier(0.23, 1, 0.32, 1)`, never `ease-in`. Button press: `scale(0.97)` on `:active`, 100-160ms. Modals/drawers: 200-500ms. `.dex-app`/`.dex-marketing` collapse CSS motion under `prefers-reduced-motion`; JS motion must gate on `useReducedMotion` itself.

## Dex-specific bans (visual contract overrides `soft-skill` here)

- No page-wide glass, stacked double-bezel cards, decorative gradients, fake neon.
- No pill-everything or large section padding outside the marketing site. App layout is dense command-centre.
- Panels keep subtle 1px borders and surface tint. Glow/outline restrained, reserved for active/running state (coral).
- No mock data, counts, or states outside marked placeholders; every number real or an honest unavailable state.

## Tier checklist (see `hive/LESSONS.md` for full text)

- **Tier 1** (small change inside a component): this brief, `impeccable` detector, screenshots at 320/768/1280px.
- **Tier 2** (new component/section/screen, or new motion): Tier 1 + all six skills in full, `plan-design-review` before building, `design-review` after, `review-animations` for motion, accessibility pass (keyboard, focus, labels, contrast, WCAG 2.2 AA).
- **Tier 3** (landing/marketing): Tier 2 + `soft-skill` as lead lens, conversion pass, `humanizer`/`no-ai-slop` on copy, German-length check, mobile Lighthouse with no LCP/INP/CLS regression.

## Skill receipts (mandatory, hive/LESSONS.md addendum 2026-10-14)

This brief is a quick reference only. It never replaces opening the skills themselves on Tier 2/3 work.

Every visual done message needs one line per skill: `skill -> what it changed in this work` (example: `emil-design-eng -> hover 150ms ease-out, press scales to 0.97`). "Followed all skills" or a skill with no concrete change does not count. Tier 2/3 need receipts for all six skills; Tier 1 needs `impeccable` plus every skill whose area the change touches.

`emil-design-eng` is open and receipted at every tier, including Tier 1, with no exceptions. If nothing moves, the receipt still names what was checked, for example `emil-design-eng -> checked: no animation added, existing hover and focus states kept`. Reviewer and overseer reject a done message with missing or empty receipts before deploy.
