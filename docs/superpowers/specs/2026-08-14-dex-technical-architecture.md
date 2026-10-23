# Dex — Technical Architecture — Phase 1 MVP

**Status:** Draft, pending founder approval
**Date:** 2026-08-14
**Scope:** Phase 1 only, per strategy doc v4 Section 6 — one action type, Segment A (DACH B2B SaaS) integration only. Segment B (Shopify/WooCommerce) connector is explicitly deferred, not built in this phase.
**Related:** `2026-08-14-dex-ai-strategy-design.md` (v4)

## ADR: Phase 1 stack

**Context:** Solo founder, 3-week build target, human-review-only (no auto-execute — GDPR/EU AI Act question unresolved per strategy doc Section 10), core ICP is Segment A. LLM provider already decided: OpenAI.

**Options considered:**

| Criterion | Next.js (App Router) | Remix |
|---|---|---|
| Solo-dev velocity | High — largest ecosystem, most starter templates, pairs directly with shadcn/ui components already standard in this founder's other projects | High, but smaller template/component ecosystem for this founder's existing conventions |
| Deploy target fit | Native Vercel integration | Also deploys to Vercel, less first-class than Next.js |
| Migration risk | Low | Low |

| Criterion | Clerk (buy) | Hand-rolled auth (build) |
|---|---|---|
| Solves core problem | 9 | 9 |
| Time to ship | Days | 1-2 weeks minimum for OAuth + session handling done correctly |
| Is this core IP? | No — GrowthGuard and the audit engine are the IP, not login | — |

**Decision:** Next.js 14 (App Router, TypeScript) + Vercel (hosting) + Postgres via Vercel Postgres/Neon + Prisma ORM + Clerk (auth) + OpenAI (LLM). Per the standing build-vs-buy rule (default: buy unless it's core IP), auth is bought, not built.

**Consequences:** Ships faster solo. No CMS-specific integration debt in week 1-3. Downside: Clerk is a paid dependency once past its free tier — acceptable, it's not the cost driver at MVP scale (OpenAI usage will be, see Section 6).

## 1. System overview

```
Customer connects Google Search Console (OAuth)
        │
        ▼
┌─────────────────────────────────────────────┐
│  Dex web app (Next.js, hosted on Vercel)     │
│                                               │
│  Growth Brain (MVP)                          │
│    → reads GSC data (indexed pages, queries, │
│      impressions/clicks) + lightweight crawl │
│      of the customer's public pages to read  │
│      current meta descriptions/titles         │
│    → flags pages with missing/weak meta       │
│      descriptions or high-impression/low-CTR  │
│      queries (the two conditions this MVP     │
│      acts on)                                 │
│                                               │
│  Creation Engine (MVP)                        │
│    → OpenAI drafts ONE improved meta          │
│      description per flagged page             │
│                                               │
│  GrowthGuard-lite (checklist, not a model)    │
│    → runs the draft through a fixed rule set  │
│      (Section 3) → PASS / FLAG / BLOCK        │
│                                               │
│  Review UI                                    │
│    → customer sees current vs. drafted meta   │
│      description + GrowthGuard result +       │
│      AI-disclosure notice, approves/edits/    │
│      rejects                                  │
│                                               │
│  "Execution" (MVP)                            │
│    → on approval, Dex shows a copy-paste-     │
│      ready block for the customer to apply in │
│      their own CMS. No write-back API in      │
│      Phase 1 — see ADR above for why this      │
│      isn't wasted scope.                       │
│                                               │
│  Audit log (Postgres)                         │
│    → every draft, checklist result, and       │
│      customer decision logged — seed data     │
│      for the future Learning Engine            │
└─────────────────────────────────────────────┘
```

## 2. Data model (Prisma schema, core entities)

```prisma
model Customer {
  id            String   @id @default(cuid())
  clerkUserId   String   @unique
  websiteUrl    String
  gscRefreshToken String?          // encrypted at rest
  plan          String   @default("free")
  autoExecuteEnabled Boolean @default(false) // opt-in, off by default (Section 4)
  actions       Action[]
}

model Action {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  pageUrl       String
  actionType    String             // "meta_description" only in MVP
  currentValue  String?            // what the crawler found, if anything
  draftContent  String
  aiDisclosure  Boolean  @default(true) // hard gate, non-optional
  guardResult   GuardResult?
  status        String   @default("pending") // pending | approved | edited | rejected
  tokenCost     Int?               // OpenAI tokens used, for unit-economics tracking
  createdAt     DateTime @default(now())
  decidedAt     DateTime?
}

model GuardResult {
  id            String   @id @default(cuid())
  actionId      String   @unique
  action        Action   @relation(fields: [actionId], references: [id])
  outcome       String             // "pass" | "flag" | "block"
  checksRun     Json               // [{check, result, detail}]
  reasoning     String             // shown verbatim in the review UI
}
```

No `Learning Engine` tables yet — deferred until 10 paying customers exist, per strategy doc Section 5/9. The `Action` + `GuardResult` pair is the audit trail that engine reads from later, so the schema doesn't need to change to support it.

## 3. GrowthGuard-lite: the MVP checklist (not a scoring model)

| Check | Rule | Maps to strategy-doc concept |
|---|---|---|
| AI-content disclosure | Always attached, non-optional | Section 7 compliance |
| No unverifiable factual claims | Scan the draft for numeric/superlative claims ("#1", "43% faster") not present in the crawled page content passed to the LLM as grounding | Hallucination check |
| No contradiction of source content | Cross-check the draft against the actual page title/content fetched by the crawler — flag if it contradicts what's on the page | Source-validity check |
| Length/format validity | Meta description within Google's ~155-character display guidance | Basic SEO-quality check |
| Duplicate-risk | Diff against this customer's other recently-drafted meta descriptions — flag near-duplicates | Lightweight cannibalization check |

`outcome`: any hard-fail (disclosure missing, contradicts source) → **block**, must regenerate, never auto-approvable. Soft-fail (length, duplicate-risk) → **flag**, shown with a warning, always requires manual review. All-pass → if `Customer.autoExecuteEnabled` is false (default), goes to manual review same as any other action; if true, `Action.status` is set to `"approved"` automatically instead of `"pending"` — the customer still applies the change themselves via the copy-paste output (Section 1), since Phase 1 has no CMS write-back API, but they skip the manual click for changes GrowthGuard already found clean. FLAG and BLOCK outcomes ignore this setting entirely — there is no code path where a flagged or blocked action skips human review.

## 4. Auto-execute toggle (added per founder request, held pending legal review per strategy-doc Section 10)

A per-customer setting (`Customer.autoExecuteEnabled`), off by default, surfaced as a toggle in account settings. Turning it on does not change what GrowthGuard checks or how it scores — it only changes what happens after a PASS. This keeps the actual judgment layer (the checklist itself) identical regardless of the setting; the toggle only affects the friction of applying an action GrowthGuard already vouched for. Log every toggle change (on/off, timestamp) in the audit trail — this is exactly the kind of customer-consent record a future legal review will want to see.

## 5. Integration specifics (Segment A only, Phase 1)

- **Google Search Console:** OAuth via Google's standard flow, refresh token stored encrypted in `Customer.gscRefreshToken`. Read-only scope only (`webmasters.readonly`) — no write access requested, reduces both OAuth consent friction and security surface.
- **Public-page crawl:** simple HTTP fetch + HTML parse (e.g. `cheerio`) of the customer's own public URLs (sourced from their GSC-indexed page list) to read current title/meta description. No auth needed — it's public content. Respect `robots.txt` and rate-limit requests per customer's domain.
- **No Shopify or WooCommerce integration in this phase** — deferred per strategy doc Section 4/6 until Segment A is validated with paying customers. When it's built, it plugs into the same `Action`/`GuardResult` model with `actionType` extended (e.g. `"product_meta_description"`) rather than a parallel system.

## 6. LLM integration and cost tracking

- One OpenAI call per flagged page, grounded only in the crawled page content (title, existing meta, headings) — the LLM isn't given room to invent facts not present in that context, which is what makes the "no contradiction of source content" check in Section 3 meaningful.
- `Action.tokenCost` logged on every call — needed to check real per-action cost against whatever pricing tier gets set once there's a live funnel to price against (strategy doc Section 9 milestone 1).

## 7. Security

- Clerk handles auth/session — no hand-rolled password or token logic.
- GSC refresh tokens and the OpenAI API key are secrets — Vercel environment variables only, never in the repo. Confirm `.env*` is gitignored before the first commit with real credentials.
- No write access requested to any external system in Phase 1 (GSC scope is read-only, there's no CMS write API) — this keeps the security and liability surface minimal while the GDPR/EU AI Act question (strategy doc Section 10) stays being held pending review, not fully closed (Section 4 above).

## 8. Build order (3-week target)

1. **Week 1:** Next.js app scaffold, Clerk auth wired, Prisma schema + Postgres connected, GSC OAuth flow working (read-only), basic crawler for a customer's public pages.
2. **Week 2:** Growth Brain flagging logic (missing/weak meta descriptions from crawl + GSC impression/CTR data), Creation Engine OpenAI call, GrowthGuard-lite checklist (Section 3) wired to every draft, auto-execute toggle (Section 4) wired to the approval-status logic.
3. **Week 3:** Review UI (current vs. draft, AI-disclosure, GrowthGuard result, approve/edit/reject, copy-paste-ready output on approval, auto-execute setting in account settings), audit logging, deploy to Vercel, first customer onboarding flow.

Explicitly out of scope for these 3 weeks: Learning Engine, scored/weighted GrowthGuard, Shopify/WooCommerce integration, CMS write-back API, GEO/AI-visibility monitoring, German localization. Adding any of these back into the 3-week window recreates the exact "too much built in parallel by one person before any customer validated it" failure mode the council premortem diagnosed.

## 9. Open questions (not blocking Week 1, need answers before Week 3)

- Real OpenAI per-call cost at current pricing, multiplied against expected free-tier usage volume — needed before setting Phase 1 pricing (strategy doc doesn't fix a number yet, deliberately, per Section 9).
- Whether the manual copy-paste "execution" step is enough friction to hurt activation — worth watching in the first few customer sessions; if it is, a lightweight one-click apply for at least one CMS becomes the next build priority, not a day-one requirement.
- GDPR data-processing posture for storing a customer's GSC data and crawled page content (strategy doc Section 10) — needs the same legal review already flagged there, before any EU customer's data is stored beyond what's minimally needed for the MVP loop.
