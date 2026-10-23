# Phase 2G — Research Intelligence: design (steps 1-9, stop at 10)

Addendum: `docs/superpowers/specs/2026-10-14-research-intelligence-addendum.md`. This doc runs the addendum's execution-order steps 1-9 and stops at step 10 for human approval — no implementation plan, no code, no schema migration, no package install beyond the read-only inspection recorded here.

## 1-2. Existing repository and architecture

Phase 2F S3 (ranked opportunity board, Finding-backed) is merged to main at `7f569ac`. Relevant existing pieces this design must extend, not duplicate:

**Audit → Finding → Action pipeline** (own-site findings):
- `src/lib/audit-agents/{seo,geo,brand}-specialist.ts` scan the company's *own* site during a `ScanJob` and write `Finding` rows (`prisma/schema.prisma` `Finding` model: `agent`, `ruleId`, `severity`, `confidence`, `evidence` Json, `limitations`, scoped to `scanJobId`/`websiteId`).
- `src/lib/agent-orchestrator.ts` consolidates findings across agents into a `DecisionRecord`.
- `src/lib/opportunity-board.ts` groups `Finding`+`Action` rows into `OpportunityGroup` (status `found|draft_ready|needs_review|failed`, `contributors[]` carrying real `Finding.id`, `severity`, `decisionRecord`). This is the one customer-facing list Mission Control shows — Phase 2 explicitly collapsed two separate lists into this single board.
- `src/lib/content-studio/*` (Phase 2F S2/S3) turns a `Finding` or `Action` into a `ContentPiece` with up to 3 `ContentVariant` drafts (angle, critique/revise, proof-layer checks, per-variant retry). `ContentPiece.sourceFindingId` / `sourceActionId` are the two ways a draft gets provenance today.

**Durable job pattern** (what "extend the existing queue architecture" means concretely):
- `GenerationJob`: idempotency key = hash of `(customerId, websiteId, actionType, targetRef, inputFingerprint)`, states `queued|running|waiting_retry|rate_limited|blocked|completed|failed|cancelled`, `provider`/`model` claimed at run time, `resultActionId` written in the same transaction as completion.
- `ProviderCircuitBreaker`: one row per `(provider, model)` pair — not per tenant — with `consecutiveFailures`, `openUntil`, doubling `cooldownMs`. This is a shared external-outage fact, already modeled exactly as a per-backend circuit breaker needs to be for Agent Reach channels.
- `ScanJob` + `ScanLogLine`: a long-running multi-stage job with `cancelRequested` polled by the loop itself (no separate worker signal channel — the DB row *is* the channel), `resultSummary` Json, per-job log lines.
- `ActionProvenance` / `ActionProvenanceFinding` (just-approved phase, `2026-10-11-action-provenance.md`): append-only row per committed generation, snapshotting inputs/evidence at write time rather than reading live — the model for what a `ResearchRecommendationProvenance` row should do for evidence instead of findings.

**Why this matters for 2G:** every one of the addendum's 14 pipeline stages (resolve identity → ... → save review-ready results) is a multi-stage, resumable, rate-limited, partial-result-tolerant background job over an external, flaky, multi-backend source. That is exactly the `ScanJob` shape plus the `ProviderCircuitBreaker` shape, not a new system. See option A/B below.

**Client identity today:** `ClientProfile` already has `brandVoice` (free-text string), `approvedClaims: String[]`, `restrictedWording: String[]`, `audience`, `markets: String[]`, `languages: String[]`. The addendum's Brand Voice Profile is an *upgrade* of fields that already exist, not a new concept — see Brand Voice section below.

## 3. Agent Reach inspection (source read only, no install)

Fetched the pinned commit `94f06c1969dfc1834001269d79d3ad0972d9dee6` as a tarball into a scratch directory outside the DEX repo and outside the hive (`/private/tmp/.../scratchpad/agent-reach-inspect/`, not kept — nothing was installed, no `pipx`, no `agent-reach install`, no network calls beyond the GitHub tarball fetch itself). Source read only, per the dispatch's safety override.

Confirmed against the addendum's October 14 snapshot:
- `pyproject.toml`: version `1.5.0`, license `MIT` (LICENSE file confirms, copyright "Agent Eyes"), `requires-python = ">=3.10"`. Matches.
- Core deps: `requests`, `feedparser`, `python-dotenv`, `loguru`, `pyyaml`, `rich`, `yt-dlp`. Optional extras: `browser` (`playwright`), `cookies` (`browser-cookie3`), `all` (both + `mcp[cli]`).
- Channels present: `bilibili.py, boss.py, exa_search.py, facebook.py, github.py, instagram.py, linkedin.py, reddit.py, rss.py, twitter.py, v2ex.py, web.py, xiaohongshu.py, xiaoyuzhou.py, xueqiu.py, youtube.py`. **Note for scope:** `boss.py` (Boss直聘, a Chinese job board), `xueqiu.py` (雪球, Chinese financial social network), `bilibili.py`, `xiaohongshu.py`, `v2ex.py` are China-market-specific platforms irrelevant to a DACH SMB customer — Agent Reach's channel list is broader than what DEX should ever enable. Source planning (pipeline stage 3) must allowlist only the channels the addendum actually names: company/competitor sites, newsrooms/blogs, RSS, GitHub, YouTube, LinkedIn, X, Reddit, industry publications.
- `cookie_extract.py`: cookie extraction is explicit-platform-only (no "extract everything" path — the all-platform function was deliberately removed per its own docstring), least-privilege (one platform at a time), and only supports Twitter/X, Bilibili, and Xueqiu for automatic browser-cookie extraction; LinkedIn/XiaoHongShu are `Cookie-Editor`-manual-export-only by the project's own policy (`_COOKIE_EDITOR_ONLY` dict — the upstream project itself already refuses automatic LinkedIn cookie extraction). Reads real Chrome/Firefox/Edge/Brave/Opera profile cookie databases from disk.
- `utils/paths.py`: credential file writes use `O_NOFOLLOW`, explicit symlink-component rejection (`ensure_no_symlink_path`), `0o600` file / `0o700` dir perms, atomic rename. This is a security-conscious implementation for *local developer machine* use — not a reason to ever let these code paths run against the production DEX server (see Production Boundary below; this confirms rather than relaxes that rule).
- `doctor.py`: `check_all()` is a pure read/report function (platform availability, cookie presence, yt-dlp config) — no writes. Confirms `agent-reach doctor --json` is genuinely non-mutating, consistent with the dispatch's safety override allowing it.
- `SECURITY.md`: standard private-disclosure policy (GitHub security advisories, 48h ack), in-scope categories explicitly include SSRF, injection (incl. prompt injection), path traversal, auth bypass — the maintainer is already thinking about the same threat classes this design must defend against.
- CLI subcommands (`cli.py`): `setup, install, configure, doctor, uninstall, skill, format, transcribe, check-update, watch, version`. The `skill` subcommand registers Agent Reach itself as an agent skill/MCP entry — **this is a second reason (beyond the dispatch's own rule 2) to never run `agent-reach skill ...` or any full `agent-reach install` against the human's actual Claude Code setup during this design phase**; only `install --env=auto --dry-run` and `doctor --json` are approved, and neither was run in this session (still pending the human's pinned-pipx-install approval).

**Supply-chain verdict:** MIT, maintained, security-policy-aware, architecturally least-privilege about cookies. The risk is not the package's own code quality — it's product-shape risk: an "all 19 channels" reach surface where DEX must impose its own allowlist, date-window, and dedup discipline (addendum sections "Strict 30-day window" / "Evidence normalization"), and a cookie-dependent subset of channels (LinkedIn, X automated reads beyond its 2 whitelisted cookie names, etc.) that must never cross into a server process.

## 4. Supply-chain and security analysis (summary)

| Check | Finding |
|---|---|
| Dependency/install-script review | No custom install script beyond `pip`/`pipx` + `project.scripts` entry point; no `postinstall`/`setup.py` hooks that execute arbitrary code at install time. |
| Secret/credential-flow review | Cookie-derived tokens land in `agent-reach`'s own config store (`~/.config/...`-style paths via `utils/paths.py`), never passed to an LLM by the library itself. DEX's obligation: never forward these to a provider, never log them, never let a server-side `ResearchProvider` implementation read a developer's `HOME`. |
| License review | MIT — compatible, no copyleft, no field-of-use restriction. |
| Prompt-injection threat review | Confirmed need: every `ResearchDocument`/`ResearchResult` returned from Agent Reach is untrusted text that can contain embedded instructions (addendum already states this; `dex-evidence-verifier` and `dex-claims-guard` are the two skills responsible for never executing or obeying anything found inside it). |
| SSRF/URL-validation review | DEX already has `src/lib/safe-fetch.ts` — any direct-URL read path DEX adds (vs. going through Agent Reach's own fetch layer) must route through it, not a bare `fetch`. |
| Platform terms/robots-policy review | Addendum already restricts to public/authorized content; design must keep an explicit allowlist (see channel note above) rather than inheriting Agent Reach's full channel list by default. |
| Rate-limit/account-ban risk | Cookie-backed channels (X, LinkedIn-via-cookie) carry real account-ban risk on a developer's personal account if hit from a shared research job queue — reinforces Production Boundary: cookie-based channels stay dev-only/manual, server-side jobs only use channels with a real API/health-check path (`ResearchProvider.healthCheck()`). |
| Failure/fallback tests | `doctor.py` + per-channel `base.py` give a natural health-check hook; `ProviderCircuitBreaker` (existing model) already implements the breaker-per-backend pattern this needs. |

No blocking issues found in Agent Reach itself. The actual risk this design must retire is **DEX's own usage discipline** (channel allowlist, 30-day window enforcement, evidence-confidence gating, never running research against a developer's cookies in production) — which is what sections 5 onward (pipeline, schema proposals, skills) exist to pin down.

## 5. Mobile problems (status, not re-derived here)

Out of explicit scope for 2G's backend design — the addendum's mobile-QA bullets ("mobile interface remains usable from 320px upward", "generation stays inside the mobile layout") describe Studio/Review UI work already tracked separately (`docs/superpowers/plans/2026-09-19-mobile-dashboard-gestures.md`; Phase 2F S3 added variant 1/2 UI to the Studio page per the S3 merge). 2G's new UI surface (a research-recommendation card) must be built against the same constraint from day one rather than retrofitted — flagged as a requirement in the design spec below, re-verified with live mobile QA at implementation time (execution-order step 14), not re-litigated here.

## 6. Customer problem and measurable product value (CEO Advisor / Founder Coach challenge)

- **Which recurring customer job becomes materially easier?** "What should I post/write about this week, and can I trust it" — today a DACH SMB owner either does this research themselves or skips it. DEX currently only tells them what's wrong with their *own* site; it has no view of the market.
- **Would a customer pay more, activate faster, retain longer?** Retention risk is the real lever: without 2G, DEX's value curve flattens once the backlog of own-site Findings is fixed (weeks, not months) — Phase 2F S3's opportunity board will eventually run dry. 2G gives DEX a reason to open the app every week even after the site is clean.
- **Is the value research volume or decision quality?** Decision quality. The addendum is explicit and correct: a generic trend-finder is not the product. The product is "DEX checked, graded, and connected it to your business" — i.e., the grading/claims-guard/evidence layer is the moat, not search breadth.
- **What can DEX do that a generic search-and-write assistant cannot?** Combine (a) the company's own verified identity + approved brand voice, (b) its own-site Finding history (already evidence-graded), and (c) external evidence passed through the same claims-guard/proof-layer discipline already built for Action/ContentPiece generation (Phase 1F policy rules, Phase 2F proof-layer). A bare ChatGPT session has none of (a) or (b), and no persistent, auditable evidence trail.
- **Which source creates unique value?** The company's own `ClientProfile`/`Finding` history is the unique asset DEX already owns; external evidence is a commodity available to anyone. The product thesis holds only if every recommendation visibly connects external evidence *to* that owned context (addendum's `businessRelevance` field is the one that must never be weak).
- **Which part is reliable enough to promise? Which stays experimental?** Promise: company-identity resolution, 30-day-window enforcement, evidence dedup, citation preservation (all mechanical, testable). Label experimental: trend-confidence scoring and "what's working" inference (addendum itself distinguishes observed-fact vs. DEX-inference vs. unknown — that three-way label is the honesty mechanism and should ship labeled, not hidden, from day one).
- **What ongoing platform dependence has been introduced?** Agent Reach itself (pinned commit, MIT, replaceable behind `ResearchProvider`) plus whichever upstream platforms it reads (GitHub/YouTube/RSS are low-risk/API-stable; LinkedIn/X read paths are the higher-churn, higher-ban-risk dependency — kept out of the server-side path per Production Boundary until a real OAuth/official-API connector exists).
- **Smallest sellable version:** Company identity + competitor resolution + RSS/GitHub/YouTube/website evidence (no cookie-dependent channels) + evidence-graded recommendation card with brand-voice-matched draft via the *existing* content-studio pipeline. No trend-velocity scoring required for v1 — "verified market development" and "insufficient evidence" labels cover the honest minimum.
- **What should explicitly not be built:** A parallel content-generation pipeline (reuse `content-studio/*`); a second customer-facing board separate from the Opportunity Board (extend it); automatic LinkedIn/X cookie-based collection in production; a single "marketing brain" skill (addendum already forbids this — 9 narrow skills, not one).

Thesis holds, with the amendment that v1 explicitly excludes cookie-dependent channels and ships the three-way evidence/inference/unknown label unconditionally (not as a later honesty upgrade).

## 7. Architecture options

### Option A — New parallel "Research" job system
A fully separate `ResearchJob` queue, separate worker, separate everything, independent of `ScanJob`/`GenerationJob`.
- *Pros:* no risk of coupling research failures to scan/generation code paths.
- *Cons:* duplicates idempotency, circuit-breaker, cancellation, and log-line machinery DEX already has twice (`ScanJob`, `GenerationJob`) and is explicitly told not to triple. Two near-identical job-state machines to maintain and test.

### Option B — Extend the existing job pattern (new `ResearchJob` model, shared `ProviderCircuitBreaker`, same worker conventions)
A new `ResearchJob` model shaped like `ScanJob` (stages, `cancelRequested` polling, `resultSummary`, `ResearchLogLine`), reusing `ProviderCircuitBreaker` keyed `(provider="agent-reach", model=<backend/channel>)`, a new `EvidenceItem` model shaped like `Finding` (scoped to `researchJobId`, same evidence/limitations/confidence pattern), and a new `ContentRecommendation` model that is deliberately *not* a new generation pipeline — it's an input row the existing `content-studio/*` consumes exactly like it consumes a `Finding` today (new `sourceRecommendationId` nullable FK on `ContentPiece`, same pattern as the existing `sourceFindingId`/`sourceActionId`).
- *Pros:* every reliability requirement in the addendum's Job Architecture section (idempotency, resumable stages, rate limiting, circuit breakers, bounded retries, cancellation, partial results, audit trail) is inherited free from code DEX already tested in Phase 1C/2A-2F. Opportunity Board extends (one more `contributors`-style source) instead of forking. Content generation, proof-layer, and GuardResult all stay single-pipeline.
- *Cons:* `ScanJob` was built site-scoped (single website per job); a research job is sometimes company-wide (competitor resolution) and sometimes website-specific (own-content voice samples) — needs a nullable `websiteId` on `ResearchJob`, not a hard requirement, which is a small, container-shaped deviation from `ScanJob`'s pattern, not a blocker.

### Option C — Option B's schema, but implemented as an external microservice calling back into DEX
Same data model, but the 14-stage pipeline runs as a separate deployable (e.g., a long-running Python worker next to Agent Reach) that calls a DEX webhook per stage.
- *Pros:* keeps Python/Agent-Reach-specific code (and its dependency surface — `yt-dlp`, `playwright`, `browser-cookie3`) entirely out of the Next.js/Node process and its dependency tree.
- *Cons:* new deployable, new auth between services, new failure domain, and directly conflicts with "production DEX server must not depend on personal browser cookies / local Chrome sessions / a developer's home-directory configuration" only if that worker is misconfigured — the dependency-isolation benefit is real but the addendum's `ResearchProvider` interface already achieves language/process isolation without a second service, since `AgentReachProvider` can shell out to a *pinned, server-managed* Agent Reach install (no cookies, API/public-page channels only) from within the existing job worker.

## 8. Recommendation

**Option B**, with the Option C dependency-isolation insight folded in at the implementation layer (not the architecture layer): `AgentReachProvider` invokes the Python CLI as a subprocess from the existing Node worker (same boundary-crossing pattern Node apps already use for provider CLIs), with no cookie-derived config ever present in the server's environment — cookie-based channels are flagged `unavailable` by `capabilities()`/`healthCheck()` in production and are a local-dev-only inspection aid, never a production data source. This keeps one job system, one circuit-breaker table, one audit-log, one Opportunity Board, and satisfies the Production Boundary section without a second deployable.

Tradeoffs accepted: `ResearchJob` needs a nullable `websiteId` (minor schema deviation from `ScanJob`); the Node-shells-out-to-Python boundary needs its own timeout/kill handling (bounded-retry requirement already demands this regardless of option).

## 9. Design specification

### 9.1 `ResearchProvider` interface (addendum's, adopted verbatim)

```ts
interface ResearchProvider {
  capabilities(): Promise<ResearchCapability[]>;
  healthCheck(): Promise<ProviderHealth>;
  search(input: ResearchQuery): Promise<ResearchResult[]>;
  read(input: ResearchDocumentRequest): Promise<ResearchDocument>;
}
```

`AgentReachProvider implements ResearchProvider`, invoked as a subprocess of the pinned, server-managed Agent Reach install (pinned commit `94f06c1969dfc1834001269d79d3ad0972d9dee6` until the human approves a release pin). `capabilities()` reports only the allowlisted channels (company/competitor sites, RSS, GitHub, YouTube, LinkedIn/X/Reddit *only* where a legitimate non-cookie read path exists, industry publications) — never Agent Reach's full 19-channel list, and never a cookie-backed channel in the production capability set.

### 9.2 Schema — proposals only, no migration until the human approves each one

All of the below follow the `ScanJob`/`Finding`/`ActionProvenance` conventions already in `prisma/schema.prisma`. None of this is applied; listed for the human's yes/no per the dispatch's rule 5.

```
model ResearchJob {        // shaped like ScanJob
  id, customerId, clientProfileId, websiteId?        // nullable: company-wide jobs (competitor resolution) vs. site-specific (voice samples)
  status            // queued|running|waiting_retry|partial|completed|failed|cancelled
  stage             // one of the addendum's 14 stages, for resumability
  cancelRequested, createdAt, startedAt, completedAt
  resultSummary Json?
  error String?
  logLines ResearchLogLine[]
  evidenceItems EvidenceItem[]
  recommendations ContentRecommendation[]
}

model ResearchLogLine { id, researchJobId, message, createdAt }   // = ScanLogLine

model EvidenceItem {        // = addendum's EvidenceItem type, persisted; shaped like Finding
  id, researchJobId, entityId, platform, provider, backend?,
  canonicalUrl, title?, author?, publishedAt, retrievedAt, excerpt,
  language, sourceType, observedMetrics Json?,
  entityMatchConfidence Float, extractionConfidence Float,
  primarySource Boolean, limitations String[]
  @@index([researchJobId]); @@index([canonicalUrl])   // dedup lookup
}

model CompetitorEntity {    // pipeline stage 2's output, user-editable per addendum
  id, clientProfileId, name, canonicalDomain?,
  classification   // direct|indirect|adjacent|unknown
  classificationReason String
  source           // how it was found (addendum's list)
  userConfirmed Boolean @default(false)   // user can edit/override
}

model BrandVoiceProfile {   // upgrade of ClientProfile.brandVoice (string) into a structured, inspectable profile
  id, clientProfileId,
  tone, sentenceLengthTendency, vocabulary Json, recurringTerminology String[],
  technicalDetailLevel, pointOfView, humourLevel, formattingHabits Json,
  phrasesToAvoid String[], approvedClaims String[], citationExpectations String?,
  sourceList Json,            // which approved sources (website/blog/LinkedIn/uploads) fed this
  sampleSize Int, confidence Float, lastUpdatedAt
  // ClientProfile.brandVoice / approvedClaims stay as the v0 fallback and seed; this table
  // is additive, not a breaking migration of the existing fields.
}

model ContentRecommendation {   // = addendum's ContentRecommendation type, persisted
  id, researchJobId, clientProfileId, websiteId,
  platform, audience, topic, opportunityType, whyNow, businessRelevance,
  companyEvidenceIds String[], externalEvidenceIds String[], competitorEvidenceIds String[],
  brandVoiceProfileId?, angle, claimsAllowed String[], claimsRequiringVerification String[],
  differentiationNote, confidence Float,
  status   // new|dismissed|converted_to_draft
}
```

`ContentPiece.sourceRecommendationId String?` (nullable FK to `ContentRecommendation`, `onDelete: SetNull`, same pattern as `sourceFindingId`) is the one new column on an *existing* table this design would need — everything else is new tables. No column is proposed as required/breaking.

`ProviderCircuitBreaker` is reused unmodified: `(provider="agent-reach", model=<channel-name>)` rows, e.g. `("agent-reach", "rss")`, `("agent-reach", "youtube")` — one breaker per channel, same doubling-cooldown logic already shipped.

### 9.3 Pipeline → job-stage mapping

The addendum's 14 stages map onto `ResearchJob.stage` exactly in order; each stage is a resumable checkpoint (same contract as `ScanJob`'s cancel-polling loop), writes its own `ResearchLogLine`, and a provider-specific failure (e.g. LinkedIn channel down) sets that channel's circuit breaker and continues with `status: 'partial'` rather than failing the whole job — directly satisfies "a failed LinkedIn connector must not destroy valid website, RSS, GitHub or YouTube findings."

### 9.4 Opportunity Board extension (how 2G builds on S3, not around it)

`OpportunityGroup` (unchanged shape) gains one more source of `contributors`: an `EvidenceItem`/`ContentRecommendation`-derived group, alongside the existing `Finding`-derived groups — same `status`/`proofLayer`/`severity` (null where not applicable, exactly as Action-only groups already do) fields, no second board, no second "needs your attention" list. A recommendation's "Create draft" action is the *same* `content-studio` entry point Finding-derived groups already use, parameterized by `sourceRecommendationId` instead of `sourceFindingId`/`sourceActionId`. This is the literal mechanism satisfying the dispatch's requirement to explain how 2G connects to S3 instead of duplicating it.

### 9.5 First-party DEX skills (narrow, typed — addendum's 9, each with trigger/inputs/outputs/tools/prohibited actions)

| Skill | Trigger | Inputs | Outputs | Prohibited |
|---|---|---|---|---|
| `dex-company-context` | New research job start | `ClientProfile`, `Website[]` | Confirmed company entity (name, domain, products, spokesperson, industry, audience, markets, languages, aliases, exclusions) | Must not proceed past ambiguous match without user confirmation |
| `dex-research-planner` | After company context confirmed | Business question, company entity | Bounded source plan: channels, queries, date window, coverage requirements | Must not query every available channel by default |
| `dex-entity-resolver` | Company + competitor resolution stages | Candidate names/domains | Confirmed/rejected identities, collision flags | Must not silently merge two same-named entities |
| `dex-evidence-verifier` | After raw results returned | Raw `ResearchResult[]` | Validated `EvidenceItem[]` (dates checked, canonical URL resolved, dedup applied) | Must not accept undated or out-of-window content as current |
| `dex-trend-analyst` | After evidence normalized | `EvidenceItem[]` | Signal label (`verified market development` ... `insufficient evidence`) with the addendum's scoring factors shown | Must not label anything "trending" without velocity/engagement evidence |
| `dex-competitor-analyst` | After competitor evidence collected | Competitor `EvidenceItem[]` | Topic/format/proof-style patterns, differentiation note | Must not output copyable competitor language |
| `dex-brand-voice` | Voice profile build/refresh | Approved-source content only | `BrandVoiceProfile` | Must reject competitor or unapproved sources as input |
| `dex-content-strategist` | Recommendation assembly | Evidence + competitor patterns + company context + brand voice | `ContentRecommendation` (pre-draft) | Must not fabricate `businessRelevance` without a traceable evidence link |
| `dex-claims-guard` | Before any recommendation/draft is shown | Draft + evidence | Claims split into supported / inference / needs-verification | Must not pass through an unsupported quantitative claim (revenue, conversions, leads) |

Each will get a full skill file (trigger conditions, evidence requirements, confidence calc, failure states, approval points, eval + adversarial examples per the addendum) at implementation time (execution-order step 11+), after this architecture is approved — not built now.

### 9.6 Claude Code skill stack (what to use, what to request)

- Already installed and in use: Superpowers (`brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion`, `finishing-a-development-branch`).
- **Requested, not installed** (per the dispatch's rule 2 — these change the human's own Claude Code setup and are not this agent's call): `anthropics/skills` marketplace for `skill-creator` (building the 9 DEX skills), `mcp-builder` (only if a dedicated research MCP server is justified at implementation time — not yet decided), `frontend-design`/`webapp-testing` (Studio/Review mobile work); `trailofbits/skills` marketplace for `audit-context-building` (before touching the research architecture for real), `supply-chain-risk-auditor` (before the human approves the pinned pipx install), `differential-review` (before shipping the final implementation). None of these were installed in this session.
- Skill register (name/source/pinned version/purpose/trigger/permissions/data accessed/failure mode/eval coverage/owner/update process) to be created as its own doc once skills are actually installed — premature to populate before step 10 approval.

### 9.7 Testing and acceptance fixtures

Addendum's fixture list adopted as-is for implementation-phase test design (unambiguous company; same-name collision; no social profiles; private LinkedIn profile; unavailable source; >30-day article; undated article; syndicated article; misleading competitor match; high-engagement/low-relevance; repeated-discussion-no-metrics; malicious prompt injection in a webpage; unsupported financial claim; too-few brand-voice samples). No fixtures built yet — this is step 9's spec, not step 12's implementation.

### 9.8 Product-value test — restated pass/fail

Per section 6: ships only if v1 excludes cookie-dependent channels from the server path, labels every recommendation with the observed/inference/unknown distinction unconditionally, and every recommendation's `businessRelevance` traces to a real `EvidenceItem` or `Finding`, not a generated plausible-sounding sentence.

---

## Step 10 — STOP

This design is not approved. No `ResearchJob`/`EvidenceItem`/`CompetitorEntity`/`BrandVoiceProfile`/`ContentRecommendation` table, no `ResearchProvider`/`AgentReachProvider` code, no pinned pipx install, and no skill files exist yet. Waiting on the human's review of this document before any implementation plan (execution-order step 11) begins.
