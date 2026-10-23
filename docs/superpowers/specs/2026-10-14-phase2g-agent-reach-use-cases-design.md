# Phase 2G: where Agent Reach adds product value (design)

Date: 2026-10-14. Builds on `2026-10-14-phase2g-council-review.md` (amendment 1: Agent Reach runs in production as a Vercel Python function for web pages, RSS and YouTube) and the G1-G4 plan (`docs/superpowers/plans/2026-10-14-phase2g-research-intelligence-plan.md`).

Question: which dashboard surfaces get real value for a DACH SMB owner from login-free outside data? Judged by three tests: does the owner act on it this week, does it trace to a dated public source, and is it a demo moment for Gate 1.

## Use cases, ranked

### 1. Research cards on the Opportunity Board (already G3)
Studio's Opportunity Board shows "write about X now" cards built from competitor pages, Google News and trade-press RSS, each with evidence. No change to the plan. This is the anchor; the cases below reuse its pipeline.

### 2. Competitor Watch on the dashboard (new, G5)
- **What the owner sees:** a "Competitors this week" card on `/dashboard/[websiteId]`, next to the Work Feed: "Müller GmbH added a new service page 'Wärmepumpen-Wartung' (8 Oct)", "Schmidt & Co changed their pricing page (11 Oct)". Each item links to the page, shows the dated excerpt, and offers one action: "Respond with a post", which opens Studio with that evidence attached.
- **How:** a weekly cron research job re-reads each competitor's key pages (home, services, pricing, blog index; at most 5 competitors × 4 pages) through the Agent Reach web channel, plus their RSS feed where one exists. A change is detected by comparing a normalised content hash stored in `EvidenceItem.observedMetrics` (`{ contentHash }`) with the previous job's item for the same `canonicalUrl`. No new column.
- **Rules:** only report a change with both versions' dates; boilerplate changes (cookie banner, footer year) are filtered by hashing the main content only; an unreachable page shows "could not check" and never "no change".
- **Why it wins:** an owner without a marketing hire never checks competitor sites. It is the clearest sales-call moment: "here is what your competitor did this week, and here is your answer, ready to approve."

### 3. Draft from a link or a video in Studio (new, G6)
- **Paste a link:** in Content Studio the owner pastes a URL (trade article, association news, their own blog post). DEX reads it through the web channel, stores it as an `EvidenceItem`, and the S2 engine drafts from it with the excerpt shown in the "Built from" card. The claims guard only allows facts present in the excerpt.
- **Their own YouTube videos:** the owner adds their channel URL once. DEX lists recent videos (yt-dlp metadata) and turns a chosen video's captions into LinkedIn, Instagram and blog drafts. The owner's own spoken words are the evidence, so drafts stay specific and in their voice.
- **Why:** most SMB owners have a few videos or articles they never reuse. This turns existing material into a week of posts, with zero invented facts.

### 4. Marketing Memory enrichment (after S4 ships, S4b)
S4 proposes brand voice and audience from the company's own crawled pages. Add the company's own blog RSS and YouTube captions as extra sources for the same `ProfileSuggestion` flow, each suggestion with its source URL and excerpt. No new table.

### 5. Answer-gap evidence on GEO findings (later, low cost)
For GEO findings such as "no clear answer section", show beside the finding how one or two competitors answer the same topic on their pages (dated excerpt). Gives the owner a concrete benchmark instead of an abstract rule. Build only after G5, reusing its competitor page reads.

## Not doing
- Logged-in channels (LinkedIn, X, Reddit, Facebook, Instagram): human decision pending.
- Search-ranking checks: need a paid SERP API, not in Agent Reach's login-free set.
- Weekly email digest of Competitor Watch: waits for Phase 4C email.
- Any "will perform" score: same rule as S3.

## Shared guards (from the council review, unchanged)
`safe-fetch` allowlist and SSRF checks before every URL reaches the Python function; fetched text is untrusted data, never instructions; 500-character excerpts; per-job token budget, per-domain caps and robots.txt; circuit breaker per channel; Agent Reach version recorded on every `ResearchJob`. Pasted links in case 3 get the same checks as any other URL.

## Order
S4, then G1-G4 as planned, then G5 (Competitor Watch), then G6 (link and video drafts), then S4b. Case 5 waits. UI in G5 and G6 is Tier 2 under the design hard rule (emil-design-eng always, skill receipts, screenshots at 320, 768 and 1280px). No schema change beyond what the council approved.
