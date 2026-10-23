# First Customer Playbook

**Goal:** land Dex's first paying customer within the strategy doc's 4-6 week window, using Segment A only (see `docs/superpowers/specs/2026-08-14-dex-ai-strategy-design.md`, Section 4). Segment B needs Shopify/WooCommerce integration that doesn't exist yet, out of scope here.

Built from the council review that concluded the dashboard redesign should wait: no one has seen the dashboard yet, so polishing it has zero conversion value at zero customers. This playbook is what to do instead.

---

## 1. ICP checklist

Pull straight from the strategy doc. Score every candidate against this before adding them to the list.

**One-paragraph ICP:** A founder-led German or DACH B2B SaaS or tech-enabled SMB, 5-50 employees, no dedicated marketing or SEO hire on staff. Already runs a subscription business, already spends money on marketing, already has Google Search Console or Analytics connected (or could in five minutes), and is reachable through LinkedIn.

**Pass criteria (all must be true):**
- German or DACH-based, or German-speaking market as primary market
- 5-50 employees
- No dedicated marketing or SEO hire (founder or a generalist owns marketing)
- Has a live website with a blog, docs, or content section (something for Dex to actually scan)
- Founder or marketing owner is active on LinkedIn

**Disqualifiers (any one, skip):**
- Enterprise or has an in-house SEO/growth team already (Sistrix/Rankscale territory, not Dex's fit per the strategy doc)
- Mittelstand company with procurement processes and long sales cycles
- E-commerce/Shopify/WooCommerce as the primary business (Segment B, not built yet)
- No public website content to scan

## 2. Where to actually find them

No paid data tool (Apollo, Clay, ZoomInfo) is available in this environment, so this is manual, but the sources are real and specific to DACH:

- **LinkedIn Sales Navigator** (free trial covers this): filter by Germany/Austria/Switzerland, company size 5-50, keywords "SaaS" or "Software" in company description, title filter for Founder/CEO/Head of Marketing. Cross-check each result against the disqualifiers above before adding.
- **Deutsche Startups** (deutsche-startups.de) and **Gründerszene** (businessinsider.de/gruenderszene): German startup press, both list company names and founders, searchable by industry.
- **StartupDetector** (startupdetector.de): German startup database with filters for stage, industry, employee count.
- **German SaaS communities**: SaaStr's German/DACH meetup groups, the "German SaaS Founders" LinkedIn group, and local founder Slack communities (e.g. via startup communities per city: Berlin, Munich, Hamburg).
- **Their own website's imprint (Impressum)**: German law requires a public Impressum with company size and legal details, useful for confirming firmographic fit quickly.

Target 20-30 candidates before qualifying down. Per the prospecting skill's own guidance: 25 verified leads beats 250 mostly-junk ones. Score each with a confidence level (High: confirmed by two sources, Medium: one source plus consistent signal, Low: flag and verify before reaching out).

## 3. Cold email sequence

No case studies or proof points exist yet (zero paying customers), so this deliberately avoids frameworks that lean on social proof (PAS, BAB, AIDA). It uses **SCQ (Situation, Complication, Question)**: a sharp observation about their situation, the complication it creates, and a low-friction question. No fake stats, no invented "customers like you" claims.

**Subject line:** lowercase, 2-4 words, looks internal. Options: `search console gaps` / `pages nobody checks` / `zero-traffic pages`

**Touch 1 (Day 1)**

```
Subject: pages nobody checks

Hi {{first_name}},

Search Console only shows pages that already have traffic. The moment
a page on {{company}}'s site goes quiet, it's invisible to every tool
built on that data, including the one you're already paying for.

I built Dex to catch those pages anyway. It crawls your full sitemap,
not just what GSC reports, flags the ones with real problems (missing
meta descriptions, thin content, duplicate titles), and drafts a fix
for each one. You approve or reject every draft before anything
changes on your site. Nothing publishes without you.

No case studies yet, it's new. But the pipeline is live and I'd
rather show you on your own site than describe it.

Worth a look?

{{your_name}}
```

**Touch 2 (Day 4, if no reply)**

```
Subject: re: pages nobody checks

{{first_name}}, following up in case this got buried.

If it's useful: I'll run a free scan on {{company}}'s site right now
and send you what it finds, no call required. Takes me five minutes,
costs you nothing.

Want me to run it?

{{your_name}}
```

**Touch 3 (Day 9, if no reply)**

```
Subject: closing the loop

{{first_name}}, last note from me on this.

If SEO/content coverage isn't a priority right now, no worries at
all. If it becomes one, the offer to run a free scan stands, just
reply any time.

{{your_name}}
```

**Personalization layer (add before sending, per prospect):**
Level 2 baseline is already in touch 1 (industry-level pain, no company specifics needed). Before sending to any specific prospect, spend 2-3 minutes adding one Level 3 or 4 detail if available: a recent LinkedIn post about growth/content, a job posting for a role that isn't marketing (signals no dedicated SEO hire), or a specific page on their site that's clearly gone stale. Swap the opening line to reference it directly. If nothing surfaces in 3 minutes, send the Level 2 baseline as-is rather than stalling the list.

## 4. Discovery + demo talk track

Solo-founder version: one call does discovery and demo together, not two separate calls, since there's no SDR handoff. Scaled to 25-30 minutes.

**Opening (2 min)**
"Thanks for making time. Before I show you anything, I want to understand what's actually going on with your site's content and SEO right now, so I only show you what's relevant. Sound good?"

**Discovery (5 min), ask, don't pitch:**
- "Who owns SEO and content today, if anyone?"
- "Do you know how many pages on your site get zero organic traffic right now?"
- "What happens today when a page's meta description is missing or weak, does anyone catch it?"
- "If I found 5-10 real problems on your site in the next 10 minutes, live, would that be useful to see?"

Listen for: no dedicated SEO hire (confirms ICP fit), a real "I don't actually know" on the zero-traffic-pages question (this is the exact gap Dex fills), any prior bad experience with an AI tool auto-publishing something wrong (this is what GrowthGuard's five checks directly answers).

**Live scan walkthrough (15 min), on their real site, connected live:**
1. Connect their Search Console live on screen ("this is read access only, nothing changes yet")
2. Run a scan, narrate while it runs: "this is crawling your full sitemap right now, not just what Search Console already tracks, that's the gap most tools miss"
3. Open the first flagged page together: "here's a real page on your site, here's what's wrong with it, here's the draft fix"
4. Walk through GrowthGuard's five checks on that draft out loud: "before this draft ever reaches you, it's checked for AI disclosure, unverifiable claims, contradictions with your existing copy, length and format, and duplicate content site-wide. Fail one, it gets flagged instead of shown to you as ready."
5. Show the approve/edit/reject buttons: "you click one of these. Nothing goes live without you. No CMS write access needed either, you copy-paste it yourself if you approve it."

**Interaction points during the demo, not just at the end:**
- After step 3: "does that match a real problem you knew you had, or is this new information?"
- After step 4: "if a draft like this showed up in your inbox, would you trust it enough to at least read it?"

**Close (5 min)**
"Based on what we just saw live on your own site: [name the specific number of flagged pages found]. I'd like to set you up so Dex keeps scanning and drafting for your site every week. [State pricing/offer if decided; if not yet, say:] I'm working out pricing with the first few customers directly rather than a fixed price sheet, want to be one of them?"

**Objection handling, direct:**
- "How do I know the AI won't say something wrong about us?" → "That's exactly what GrowthGuard's five checks exist for, you just watched one draft go through them. Nothing publishes without your approval regardless."
- "We don't have time to review drafts." → "You just watched the whole review take under a minute. And you can turn on auto-execute later, per customer, opt-in only, and even then it only ever applies to drafts that pass all five checks clean."
- "This feels early / unproven." → Be honest: "It is early, you'd be one of the first. What I can offer instead of a track record is direct access to me and fast iteration on what you actually need." Don't fabricate a case study to counter this.

---

## What this playbook deliberately does not include

No fake testimonials, no invented metrics, no case studies that don't exist yet. Every claim above is either about how the product mechanically works (verifiable by running it live) or explicitly flagged as unproven. Selling honesty about being early is the strategy here, not working around it.
