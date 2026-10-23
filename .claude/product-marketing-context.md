# Marketing Context

*Last updated: 2026-08-14*
*Source: drafted from `docs/superpowers/specs/2026-08-14-dex-ai-strategy-design.md` (v4) — pre-launch, no codebase/landing page exists yet. Sections below marked TBD are genuinely unfilled, not guessed.*

## Product Overview
**One-liner:** AI that grows your business without gambling with it.
**What it does:** Dex audits a business's website and search/AI-answer visibility, drafts specific fixes (starting with SEO meta descriptions and structured data), and runs every proposed fix through GrowthGuard — a rules-based safety check — before anything reaches the customer for approval. Nothing publishes without either explicit approval or an opt-in auto-execute setting the customer controls themselves.
**Product category:** AI SEO/GEO (Generative Engine Optimization) growth agent, with a safety/governance layer as the core differentiator — not a generic "AI SEO tool."
**Product type:** SaaS.
**Business model:** Subscription, tiered. Exact price point TBD — deliberately not fixed yet (strategy doc Section 9): first pricing decision comes after real per-action OpenAI cost data exists, not before.

## Target Audience
**Target companies:** Two segments of the same core product, both DACH (Germany/Austria/Switzerland), both without a dedicated marketing/SEO hire:
- Segment A: founder-led German B2B SaaS and tech-enabled SMBs, 5-50 employees.
- Segment B: German/DACH Shopify and WooCommerce store owners, same size profile.
**Decision-makers:** The founder/owner directly — this ICP has no separate marketing department to sell through.
**Primary use case:** Being found — in Google search and increasingly in AI answers (ChatGPT, Perplexity, Google AI Overviews) — without hiring an agency or an in-house SEO person.
**Jobs to be done:**
- Find out what's actually wrong with our SEO/AI-visibility without paying for an audit.
- Get specific, ready-to-apply fixes instead of a report full of jargon.
- Trust that an AI tool won't do something reckless to a site we depend on for revenue.
**Use cases:**
- A B2B SaaS founder wants their pricing/features pages to rank and to be cited correctly when someone asks an AI assistant to compare tools in their category.
- A Shopify store owner wants product pages to have real, non-generic meta descriptions and structured data without manually editing hundreds of listings.

## Personas

| Persona | Role | Cares about | Challenge | Value we promise |
|---------|------|-------------|-----------|------------------|
| Founder/owner (Segment A or B) | User + Champion + Decision Maker + Financial Buyer | Revenue impact, not vanity SEO metrics | No time or expertise to supervise an AI tool touching their live site | Fixes worth applying, and a system that tells them clearly when *not* to act |

*Note: this ICP collapses all four buying roles into one person — there is no separate technical influencer or budget-holder to persuade. That's a deliberate simplification from the strategy doc's ICP definition, not a gap.*

## Problems & Pain Points
**Core problem:** Not found in search, and increasingly not found in AI answers either — with no in-house expertise to fix either problem.
**Why alternatives fall short:**
- Agencies are expensive relative to value delivered (BrightLocal 2025: 73% of SMBs, global sample, aren't confident their marketing strategy is working; 70% of agencies raised prices 2024-25).
- Existing AI SEO tools (Okara, Search Atlas/OTTO) already have approval gates, but the gate is binary — approve or reject, no explanation of *why* something is risky, no learning from what worked.
**What it costs them:** Lost organic traffic and lost AI-answer visibility, compounding as the AI-answer channel grows.
**Emotional tension:** Fear that "AI automation" on a live business site means reckless, hard-to-reverse changes — this is the core objection the whole GrowthGuard concept exists to answer.

## Competitive Landscape

| Competitor | Type | How they fall short |
|-----------|------|---------------------|
| Sistrix (Bonn) | Direct (DACH) | Monitors AI visibility well (13+ year German SEO data moat) but doesn't execute fixes |
| Rankscale (Vienna) | Direct (DACH) | Tracks 17+ AI engines, published German case study, but execution is limited |
| Okara (Singapore) | Secondary | Has an approval gate ("drafts for your approval") but it's binary — no risk scoring, no DACH presence |
| Search Atlas / OTTO SEO | Secondary | Has approval mode, rollback, change logs — but risk assessment is binary, not scored or reversibility-weighted |

**Positioning line for this table (from the strategy doc):** "Most platforms optimize one part of the loop — monitoring, AI visibility, or execution. Dex is built around the complete loop — discover, decide, create, verify, execute, learn — with a risk-aware decision layer between intelligence and action that gets more accurate over time."

## Differentiation
**Key differentiators:**
- GrowthGuard: every proposed action is checked against an explicit rule set before it reaches the customer, with named reasons shown, not a bare approve/reject toggle.
- Explainability: "source confidence: low," "cannibalizes an existing ranking page" — reasons, not scores with no visible logic.
- Customer-controlled auto-execute: opt-in, off by default, and even when enabled, only ever applies to actions GrowthGuard already scored clean (PASS) — flagged or blocked actions always require manual review regardless of the setting.
**How we do it differently:** A rules/decision layer sits between "AI found an opportunity" and "AI takes action" — competitors have a review step, Dex's review step explains itself and never auto-approves anything it flagged as risky.
**Why that's better:** Turns "AI touched my site and I don't know why" into "AI explained exactly what it checked and what it found" — this is the trust mechanism the whole positioning depends on.
**Why customers choose us:** Not because Dex is the only tool with automation (it isn't) or the only one with a review step (it isn't) — because it's the only one that makes the review step itself trustworthy and legible.

## Objections

| Objection | Response |
|-----------|----------|
| "I don't want an AI auto-editing my live site." | Nothing auto-publishes by default. Every action needs your approval unless you explicitly opt in to auto-execute — and even then, only for changes GrowthGuard already found clean. |
| "Every AI SEO tool already has an approval step, what's different here?" | Their approval step is a yes/no toggle with no explanation. Ours tells you exactly what it checked, what it found, and why — plus it never auto-approves anything it flagged. |
| "How do I know this won't tank my SEO like scaled AI content has for other sites?" | GrowthGuard explicitly checks for the patterns Google's own spam policy penalizes (scaled content abuse, unverifiable claims, duplicate/cannibalizing content) before anything reaches you. |

**Anti-persona (NOT a good fit):** Enterprise companies with existing marketing teams and established SEO tooling (Sistrix/Rankscale's actual customer tier — Bosch, UBS, Cartier-scale) — Dex is built for the founder-led, no-marketing-hire segment specifically, not as an enterprise SEO platform.

## Switching Dynamics
**Push (away from current):** Paying agency retainer prices for uncertain results; or doing nothing and watching AI-answer visibility become a real channel with zero presence there.
**Pull (toward us):** Specific, ready-to-apply fixes plus a legible reason to trust an automated tool with a live business asset.
**Habit (keeping them stuck):** Manually managing SEO in spare time, or an existing agency relationship that's inertia more than satisfaction.
**Anxiety (about switching):** "What if the AI breaks something and I don't notice until it's too late" — directly addressed by GrowthGuard's default-to-manual-review behavior.

## Customer Language
**How they describe the problem / how they describe us / verbatim quotes:** TBD — no customers yet (pre-launch). Do not fabricate quotes here; collect these from the first pilot customers per strategy doc Section 9 milestone 1 and fill this section then.
**Words to use:** "explains itself," "won't gamble with your site," "shows what it checked."
**Words to avoid:** "fully autonomous," "100% safe," "guaranteed" — the strategy doc is explicit that Dex should never claim guaranteed safety, only "risk assessment."

| Term | Meaning |
|------|---------|
| GEO | Generative Engine Optimization — being cited by AI answer engines (ChatGPT, Perplexity, Google AI Overviews, Gemini), distinct from traditional SEO |
| GrowthGuard | The rules-based check every proposed action passes through before a customer sees it |
| PASS / FLAG / BLOCK | GrowthGuard's three possible outcomes for a proposed action — only PASS is ever eligible for the opt-in auto-execute setting |

## Brand Voice
**Tone:** Direct, calm, non-hype. Explicitly avoids AI-marketing bravado ("revolutionary," "game-changing").
**Style:** Plain-spoken, shows its work — reasoning is part of the product experience, so it should be part of the copy too.
**Personality (draft, not yet founder-validated):** Careful, transparent, unshowy, competent.
**Voice DO's:** Explain *why*, not just *what*. Show the reasoning behind a recommendation the way the product shows GrowthGuard's reasoning.
**Voice DON'Ts:** Never claim guaranteed safety. Never claim to be first with a feature competitors already ship (approval gates exist elsewhere — say so, and explain what's actually different).

## Style Guide
TBD — not yet defined. Populate once there's live copy to derive conventions from (working name "Dex" is unconfirmed — trademark/domain clearance not run per strategy doc, so capitalization/usage conventions aren't worth fixing yet).

## Proof Points
TBD — pre-launch, no metrics, no customers, no testimonials exist yet. First proof points arrive at strategy doc Section 9 milestone 1 (first paying customer). Do not populate this section with placeholder numbers.

## Content & SEO Context
TBD — no live pages, no keyword research run yet. Populate once the Phase 1 MVP (technical architecture doc, Section 8 build order) ships and there's a real landing page to optimize.

## Goals
**Business goal:** Reach the milestone sequence in strategy doc Section 9 — first paying customer within 4-6 weeks of MVP launch, then 10 paying customers to unlock the Learning Engine build. The original €1M-by-Q1-2027 target was removed as a scope-driving anchor (council premortem finding) — revisit only once real conversion data exists.
**Conversion action:** Sign up and connect Google Search Console (Phase 1 integration) to get the first free audit.
**Current metrics:** None yet — pre-launch.
