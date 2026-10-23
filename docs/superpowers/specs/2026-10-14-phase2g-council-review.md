# Phase 2G Research Intelligence: council review and approval

Date: 2026-10-14. Reviewed: `2026-10-14-phase2g-research-intelligence-design.md` (Dwight, steps 1-9).
Council: CEO advisor, CMO advisor, founder coach, run by the overseer at the human's request. The human then approved the design with the amendments below.

**Decision: APPROVED with six amendments.** Option B (extend the existing job pattern) stands. The amendments change how sources are fetched in production and cut v1 down to what two Claude agents can build and verify.

## What the design gets right

- Option B reuses `ScanJob`, `ProviderCircuitBreaker`, the Opportunity Board and the content-studio pipeline instead of building a second system.
- Section 6 picks the right moat: decision quality and the link to the company's own Finding history, not search volume.
- Cookie-based channels stay out of the server, and every recommendation carries the observed / inference / unknown label.
- The Agent Reach source read was done without installing anything.

## Amendments

### 1. Agent Reach runs in production for login-free channels (human override, 2026-10-14)

The human overrode the earlier "dev-only" ruling: Agent Reach (v1.5.0, installed on the dev machine) is part of the production research engine.

- DEX has no long-running worker and no subprocess code in `src/`. Jobs run as Vercel functions triggered by cron. Agent Reach therefore runs as a separate Vercel Python function (Python 3.12+, Fluid Compute) that the Node research job calls over an internal, authenticated route. The function returns normalised evidence to the `ResearchProvider` interface; it never writes to the database itself.
- v1 production channels are the login-free ones that `agent-reach doctor` reports as working: web pages (Jina Reader backend), RSS (feedparser) and YouTube metadata and captions (yt-dlp). URLs still pass the `safe-fetch` allowlist and SSRF checks before they reach the function.
- Channels that need a logged-in account or cookies (LinkedIn, X, Reddit via browser extension, Facebook, Instagram) are not in this plan. The human decides those separately. Agents do not configure cookies or accounts for them.
- Pin the Agent Reach version in the function's requirements and record it on every `ResearchJob`.

### 2. v1 sources chosen for DACH SMB owners (CMO)

The design's smallest sellable version names RSS, GitHub, YouTube and websites. GitHub is irrelevant to a bakery, a craft business or a dental practice. For the ICP, the sources that matter are:

- **Competitor websites**: homepage, service and pricing pages, blog and news pages, plus their RSS or sitemap where one exists. Fetched with `safe-fetch`. Highest value: what competitors changed and are saying.
- **Google News RSS search** (`news.google.com/rss/search`, `hl=de`, `gl=DE`/`AT`/`CH`): public, needs no key, and gives dated local and trade-press coverage for the industry and region.
- **Trade-press and association RSS feeds** that the user adds or that DEX finds on the company's or competitors' sites.
- **The company's own site and Findings**, which already exist.

- **YouTube** through Agent Reach (amendment 1): competitor and industry video titles, descriptions and captions.

Not in v1: Reddit, LinkedIn, X, Facebook and Instagram (logged-in channels, human decision pending), GitHub (only for software customers).

### 3. Narrower v1 scope (founder)

DEX has no paying customers yet (Gate 1 is still open), and only Michael and Dwight can build. v1 ships the "Smallest sellable version" and nothing more:

- In v1: company context, user-editable competitor list, research job, evidence collection from the amendment-2 sources, strict 30-day window, deduplication, evidence grading, claims guard, recommendation card on the Opportunity Board, and "Create draft" through the existing content studio.
- Deferred to v2: trend-velocity scoring (v1 uses only the labels "verified market development", "repeated discussion" and "insufficient evidence"), the competitor-pattern analyst, the `BrandVoiceProfile` table, and engagement metrics.
- The first-party skills shrink to four: `dex-entity-resolver`, `dex-evidence-verifier`, `dex-content-strategist` and `dex-claims-guard`. The others wait for v2.
- 2G must also help Gate 1: a recommendation card is a demo moment for the first 3-5 owners. Build it so a founder can show it in a sales call.

### 4. Brand voice comes from S4, not a new table (CEO, CMO)

S4 already proposes `brandVoice`, `audience` and other values from the customer's own crawled pages, with source and excerpt, accepted by the customer. That is the approved-source voice the addendum asks for. v1 uses `ClientProfile` fields filled by S4. `BrandVoiceProfile` waits for v2, once S4 shows whether the simple fields are enough. **S4 is unpaused and ships before 2G.**

### 5. Schema approved for v1 tables only (human yes, given via the overseer)

Approved for v1: `ResearchJob` (nullable `websiteId`, status including `partial`), `ResearchLogLine`, `EvidenceItem`, `CompetitorEntity`, `ContentRecommendation`, and `ContentPiece.sourceRecommendationId` (nullable, `onDelete: SetNull`). Not approved yet: `BrandVoiceProfile`. Dwight reviews the migration before merge; the human runs it on production at release. Additive only.

### 6. Privacy, cost and safety guards (council)

- **DSGVO**: store only the excerpt needed as evidence (cap of about 500 characters), store no personal data beyond a publisher or author name shown on a public page, and give evidence a retention period (proposal: 180 days, then delete the excerpt and keep the URL and dates). The retention period needs the human's yes before launch.
- **Cost**: a hard per-job token budget and per-job cost recorded, reusing the existing `tokenCost` pattern. A job that hits its budget stops with `partial`.
- **Fetch limits**: a per-job and per-domain request cap, respect for `robots.txt`, and the existing circuit breaker per source.
- **Untrusted content**: fetched text is never an instruction. It goes through the existing untrusted-data boundary used for crawled pages, and the prompt-injection fixture is a release blocker.

## Build plan (Claude agents only; Pam and Ryan are out of usage)

Order: S4, then 2G slices G1 to G4. Dwight builds. Michael coordinates and does the second review, because Ryan is out. The overseer verifies and deploys with the human's yes. Every slice follows `hive/LESSONS.md`, including the design hard rule (Tier 2, emil-design-eng always, skill receipts) for anything visual.

1. **S4 finish** (Pam's branch `agent/pam-phase2f-s4`, Dwight takes over): AI-suggested Marketing Memory from the company's own pages. Migration already reviewed CLEAN.
2. **G1, data and sources**: v1 schema, the `ResearchProvider` interface, the native connectors from amendment 2, the 30-day window, dedup, evidence normalisation, and fixtures (undated, older than 30 days, syndicated, same-name company, unavailable source, prompt injection).
3. **G2, company and competitors**: company context and a user-editable competitor list with a classification reason. UI at Tier 2.
4. **G3, recommendations**: evidence grading, claims guard, recommendation builder, a card on the Opportunity Board led by topic, why now, why it fits, what DEX found and angle, with "Evidence and reasoning" behind a disclosure, and "Create draft" into the content studio. UI at Tier 2, mobile from 320px.
5. **G4, hardening**: budgets, caps, cancellation, partial results, circuit breakers, the full fixture suite, and a security review of the fetch paths.

Each slice: tests first, tsc, vitest, `NODE_ENV=production next build`, then "<slice> ready to ship" to the overseer with the hash.

## Skills to use

- Every slice: `superpowers:writing-plans` (one plan for G1-G4 before code), `superpowers:test-driven-development`, `superpowers:verification-before-completion`, and `engineering-skills:senior-backend` or `senior-fullstack`.
- Schema: `engineering-advanced-skills:database-schema-designer`.
- Fetch paths and untrusted content: `engineering-skills:senior-security` and `engineering-skills:ai-security`.
- UI: the six design skills under the hard rule, with `emil-design-eng` always.
- Copy: `humanizer` and `no-ai-slop`.
- Requested from the human, not installed by agents: `skill-creator` (anthropics/skills) for the four DEX skills, and the Trail of Bits review skills. Until they are installed, write the DEX skill files by hand in Anthropic's SKILL.md format and use `engineering-skills:adversarial-reviewer` for the security pass.
