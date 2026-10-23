# Dashboard information architecture (design)

Date: 2026-10-16. Status: decided by the overseer at the human's request (ui-ux-pro-max, taste-skill, apple-design, emil-design-eng, cmo-advisor, founder-coach, marketing CRO). Builds on the dashboard audit slice and the 2G cards (G5 Competitor Watch, G3 recommendations, G6 evidence picker).

## Problem

Overview (`src/app/dashboard/[websiteId]/page.tsx`) stacks about 16 blocks in one column: website entry, command bar, daily mission, live scan terminal, work feed, competitors, top opportunities, opportunity map, site graph, next mission, agent evidence, evidence ledger, site brief, AI summary, and four stat cards. The pending count shows in three places, and the one-sentence summary sits at the very bottom. An SMB owner without a marketing hire cannot tell what to do first.

Test for every block: **does the owner act on it this week?** If not, it does not belong on Overview.

## Rules

1. Overview answers one question: "What should I do today?" At most 5 blocks.
2. Every block has one verb button (Review, Respond, Write post, Check again). No block is only a number.
3. Each count appears once on the page.
4. Diagnostics (how Dex works, history, charts) live on Analytics. Results live on Outcomes.
5. Moving cards is additive (rule 7): cards move tabs with their styles, effects and animations intact. Nothing is deleted.
6. Mobile shows the same blocks in the same order, one column.

## Overview, top to bottom

| # | Block | Built from | Primary action |
|---|---|---|---|
| 1 | **Today**: the AI summary sentence as subtitle, then up to 3 "waiting for you" rows (pending reviews, competitor changes, post ideas) | `DailyMissionCard` + pending count + `NextMission` + `AiInsightSection` sentence | One button for the most valuable item, e.g. "Review 11 changes" |
| 2 | **Fixes for your site**: top opportunities with plain-language labels | `OpportunityBoard` | Review |
| 3 | **Competitors this week** (left) and **Post ideas** (right, top 3 G3 recommendations) | `CompetitorWatchCard` + recommendation teaser | Respond with a post / Write post (opens Studio with evidence attached) |
| 4 | **Ask Dex** command bar, single line | `CommandBar` | Go |

A slim scan status line sits in the header next to the site URL: "Last checked 2 days ago · Check again". It expands into the `LiveScanPanel` terminal only while a scan runs. The dark idle terminal block no longer shows when idle. `WebsiteEntryPanel` moves into the site switcher ("Add website") so Overview has one input.

## Analytics ("How Dex checked your site")

Moved here unchanged: `OpportunityMapChart`, `SiteGraphChart`, `AgentEvidenceSummary`, `AgentEvidenceLedger`, `SiteBrief`, the full `RealWorkFeed`, the four `StatCard`s, plus everything already on the tab.

## Outcomes

Unchanged.

## New 2G cards (design check)

- **Competitors this week, empty state:** replace the tall empty box with one line and two actions: "No changes yet. Dex checks every Monday." [Add competitors] (Settings) [Check now]. The card height fits its content.
- **Post ideas:** top 3 recommendations with topic, why now (one line) and source date. The full board stays in Studio.
- **Studio evidence picker (G6):** move "Paste a link / Pick a video" above Topic, because the source comes before the post. Use the segmented-control style of the "From opportunity / From topic" switch, not a solid orange button, so only one primary orange button remains (Generate). Make "Load evidence" a visible secondary button. When a German market is set, default the language to German.
- The Generate button, when disabled, uses a neutral disabled style with a reason ("Add a topic or pick a source").

## Acceptance

- Overview renders at most 5 blocks; tests assert the block list and order.
- No count is rendered twice on Overview (test).
- Every moved card renders on Analytics with its original classes (snapshot or class assertions).
- Competitor empty state, Post ideas and Today have tests for empty, loading and filled states.
- Tier 2 design rule: emil-design-eng always, skill receipts, screenshots at 320, 768 and 1280px for Overview, Analytics and Studio.
