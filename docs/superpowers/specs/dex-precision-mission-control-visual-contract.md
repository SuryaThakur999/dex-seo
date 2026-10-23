# Dex Precision Mission Control — Visual Contract

This document translates the approved visual references into testable implementation requirements. The images remain the visual source of truth; this contract exists so reviewers can identify substitutions, omissions, and fabricated data.

## Global visual language

- Desktop target: approximately 1440×1024, dense but readable command-centre layout.
- Mobile target: approximately 390×844, single-column flow with persistent bottom navigation.
- Base canvas: warm near-black rather than blue-black.
- Primary accent: coral orange, reserved for primary actions, active navigation, running state, selected borders, and key events.
- Success/evidence accent: signal mint.
- Warning: amber. Destructive: muted red. Neutral/unavailable: grey.
- Typography: modern sans for interface; compact monospace only for terminal/game/system labels.
- Panels: subtle 1px borders and surface tint; restrained glow only around the active audit/game surface.
- No page-wide glass, excessive blur, stacked cards, decorative gradients, or fake neon everywhere.
- Desktop left rail: fixed, narrow, labelled destinations. Top utility row holds client/site, optional integration status, locale, theme, and user.
- Mobile: no compressed left rail. Use bottom navigation with Mission, Studio, Review, Settings.
- All figures in reference images are illustrative. Production must use real data or an explicit unavailable/empty state.

## Screen 01 — Mission Control desktop

### First viewport hierarchy

1. Utility bar: client selector, site selector, GSC optional status, GA4 status, language/market, theme, account.
2. Active audit module spanning the content width.
3. Overview/Analytics/Outcomes tabs.
4. Two-column evidence area: Opportunity Board about two-thirds; visual evidence about one-third.
5. Bottom row: Next mission and Agent evidence.

### Active audit module

- Orange luminous outline appears only while queued/running.
- Left zone: `DEX OS`, large plain-language state, supporting sentence, one URL field and one Run audit action.
- Centre zone: real event stage list with completed mint checks, active orange ring, future grey rings, timestamps/status, and `Furthest stage recorded` unless current execution is proven.
- Right zone when offered: compact game invitation, never a second unrelated black panel.
- Controls: Expand technical report, Watch activity, Play while Dex works.
- Completion state collapses into a receipt rather than leaving a large terminal open.

### Opportunity Board

- One grouped table, not separate “Needs attention” and findings lists.
- Columns: Issue, Pages, Locale, Draft status, ProofLayer status, Action.
- Row separators, not a separate card per opportunity.
- ProofLayer status names what passed; unresolved issue remains visually distinct.
- Footer states how many opportunities are shown and links to Review.

### Live Site Graph reference

- Radial node graph: Home central; grouped/template pages around it; mint/orange/grey semantic status.
- Only implement when real page-link edges are persisted. URL path guessing is forbidden.
- Until then, use an honest unavailable state or omit the graph; do not replace it with a decorative fake.

### Bottom modules

- Next mission: one recommended real action and one CTA.
- Agent evidence: real specialist/scan events shown as a short horizontal evidence timeline.

## Screen 02 — Analytics

### Header and controls

- Page title and one-sentence explanation.
- Range controls: 7d, 14d, 30d, 90d.
- Site, market/locale, and agent filters only when backed by real filtering.
- Explicit note that outcome measurement uses its own fixed window.

### Metric row

- Four equal cards: Pages crawled, Findings created, Drafts ready, Median review time.
- Each card shows value, directional comparison, comparison period, and icon.
- Missing comparison is unavailable, never `0%`.

### Audit funnel

- Five connected stages: Discovered → Crawled → Findings → Draft-ready → Approved.
- Counts and stage-to-stage percentages.
- Footnote explaining pages outside scope, blocked, or excluded.
- Funnel is operational conversion, not an SEO score.

### Data coverage

- Calendar-like daily scan strip.
- Mint = completed; orange outline = running; grey = no scan.
- GSC panel below it with Connected or Unavailable, plus truthful explanation.

### Activity over time

- Large line chart with switchable metric: Crawl activity, Findings, Draft success, Review time.
- Solid segments for measured data; dotted gap for missing data; event markers for real events.
- Axis labels, unit, legend, range, and accessible description required.

### Bottom row

- Finding mix: donut chart by real finding type.
- Generation health: Ready, Queued, Rate-limited, Failed plus cost per accepted draft only if calculable.
- Agent contribution: real reviewed/approved/evidence counts only; otherwise unavailable.

## Screen 03 — Review master-detail

### Desktop structure

- Header plus count of decisions awaiting review.
- Search and compact filters across the top.
- Left master list approximately 45%; right detail approximately 55%.
- Left list groups actions by issue type and shows title, path, locale, age, draft state, and ProofLayer state.
- Selection uses a restrained orange outline.

### Detail panel

1. Action type, draft title, URL, risk, draft state, locale.
2. Search-preview card with honest truncation note.
3. Before/After and word-diff controls.
4. Clear red removal and mint addition treatment.
5. Source evidence list with real excerpts and paths.
6. ProofLayer checks labelled individually.
7. Evidence lineage: crawl evidence → regional pack → draft → ProofLayer.
8. Persistent bottom action bar: Reject, Edit draft, Approve draft.

- Approval marks a draft ready; Dex does not claim automatic publication.
- Mobile becomes list → dedicated detail route, not a squeezed split view.

## Screen 04 — Content Studio

### Layout

- Title and New draft at top.
- Upper workspace: creation controls roughly one-third; large platform preview roughly two-thirds.
- Lower strip: Proof Shield across width.
- Bottom: status tabs and draft table.

### Creation controls

- From opportunity / From topic switch.
- Source finding with evidence-verification state.
- Audience, objective, market, language, platform.
- One primary `Generate reviewed draft` action.
- Supporting note: uses crawl evidence and approved brand facts.

### Preview

- Orange active outline and subtle terminal grid.
- Explicit `Preview — not published` label.
- Recognizable selected platform icon and preview structure.
- Main copy plus platform-appropriate rich preview when real source media exists.
- Side metadata: character count, language, market, source.
- Channel variants list with Generate variant actions; never imply direct publishing.

### Proof Shield

- Crawl evidence, Brand facts, Platform rules, Regional context, Language review.
- Precise verified/review-needed count.
- Edit, Regenerate, Copy export actions.

### Draft list

- Tabs: Drafts, Ready, Failed, Archived.
- Columns: Platform, Title, Source opportunity, Objective, Language/market, State, Updated, Action.
- Use real platform icons with correct licensing.

## Screen 05 — Outcomes

### Header metrics

- Changes approved, Awaiting measurement, Evidence ready, Measured win rate.
- Win rate always includes sample size.

### Measurement journey

- Horizontal stepper: Approved → Baseline captured → 28-day observation → Outcome measured → Evidence ready.
- Each step shows real date/window/status.
- Adjacent GSC card explains that public audits work without GSC and measured search performance requires real GSC data.

### Measured changes table

- Columns: Page/Issue, Action type, Change date, Baseline window, Outcome window, Clicks delta, Impressions delta, Confidence basis, Evidence.
- Expanded row contains a before/after line chart with shaded baseline and observation periods, approval marker, data source, sample, and causality disclaimer.
- Confidence labels are permitted only from transparent sample/evidence rules.

### Bottom row

- Operational outcomes: Approved → Exported → Deployed → Reverted.
- By action type: measured proportion and honest no-data states.
- Upcoming measurements: real expected dates and Open evidence record.
- Never call action-level deltas sitewide growth.

## Screen 06 — Mission Control mobile

- App content only; implementation should not render browser/device chrome.
- Header: Dex identity, client/site selector, live state, account.
- Large title and date.
- Audit module becomes a single column with URL/action, four-stage progress, short event list, Watch activity and Play controls.
- Game invitation becomes its own compact module beneath the audit module.
- Next mission follows immediately.
- Overview/Analytics/Outcomes segmented control remains horizontally readable.
- Opportunities become compact rows with Issue, page count, Draft status, ProofLayer status, and chevron.
- Site graph may become a simplified real-data graph only if supported.
- Persistent bottom nav: Mission, Studio, Review with badge, Settings.
- No horizontal overflow; bottom navigation must not cover content/actions.

## Screen 08 — Settings

### Desktop structure

- Header with client-profile selector.
- Internal settings navigation: Workspace, Websites, Integrations, Language & market, Agent preferences, Appearance, Audit log, Team & permissions.
- Main website workspace plus selected-site summary rail.

### Websites

- Real entitlement bar such as `2 of 3 websites used`.
- Add website action and URL form.
- Table: Website, Public audit, GSC, GA4, Language/market, Last audit, Actions.
- Public audit readiness is independent of Google.
- Selected-site panel separates Public audit, Search Console, GA4, market, language, and audit preferences.

### Bottom settings modules

- Regional intelligence lists only actually supported locales. Do not show checked coverage for unimplemented packs.
- Scan experience: Ask each scan, Always open activity, Offer Index Quest, Disable play.
- Appearance: Light, Dark, System.
- Enterprise/team/privacy controls appear only when working.

## Screen 10 — Index Quest

- Dex Signal is the player: coral-orange floating scanner, black face, cream eyes, mint signal antenna.
- Game occupies the right side of the active audit module; scan status remains independently visible on the left.
- Header: Index Quest, Arcade score, stage, real audit status, Pause, Exit.
- Environment uses original URL platforms, sitemap bridges, canonical gates, schema elevators, mint signals, 404 ghosts, broken-link gaps, and redirect-loop portals.
- No copied characters, pipes, mushrooms, blocks, sounds, environments, or distinctive designs from protected games.
- Control bar: directional movement, jump, keyboard/touch hint.
- Game state never changes scan state.

## Pixel-comparison and acceptance protocol

For each implemented screen:

1. Capture the same viewport and state as the reference.
2. Place implementation and reference side by side.
3. Compare shell, hierarchy, section order, width ratios, density, typography scale, spacing, borders, color use, chart type, labels, and interaction affordances.
4. List every material difference.
5. Classify each difference as required by real data, accessibility, responsive constraints, or implementation defect.
6. Fix defects in one consolidated pass.
7. Do not report a match from code inspection alone.

An implementation is not equivalent when it merely contains the same feature names. The visible hierarchy, chart form, state treatment, grouping, and decision flow must match the reference direction.

## Honest deviations

- `G44` in generated references means `GA4`.
- Mock dates, counts, URLs, confidence, agent contributions, regional coverage, and outcomes must be replaced with real values or unavailable states.
- Live Site Graph is deferred until real page-link edges are stored.
- Regional Coverage Matrix is deferred until locale-aware checks produce real per-market evidence.
- Where reference content implies a nonexistent integration, keep the layout but render a clear unavailable/not connected state without a working-looking fake control.
