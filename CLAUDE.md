# Dex — Project Instructions

## Mandatory Skill Routing

Every task worked on in this project must be routed through the right specialist skill(s) before execution — not answered directly from general knowledge. This applies to every entry point: a fresh prompt, a continued conversation, a subagent, a background task. A `UserPromptSubmit` hook in `.claude/settings.json` enforces this by injecting a reminder on every prompt submitted while working inside this project (main checkout or any worktree under `.claude/worktrees/`) — it fires even in a brand-new terminal session, since it lives in committed project settings, not session state.

**Before writing any code or making any product/strategy decision in this project, identify which of the following applies and invoke that skill via the Skill tool. Multiple skills can apply to one task — invoke all that do.**

### Engineering — by layer
| Task touches | Skill |
|---|---|
| React/Next.js components, `.tsx` files, UI state | `engineering-skills:senior-frontend` |
| API routes, `src/lib/*.ts` business logic, Prisma/DB | `engineering-skills:senior-backend` |
| Full-stack feature spanning both | `engineering-skills:senior-fullstack` |
| New architecture, multi-file design decisions | `engineering-skills:senior-architect` or `engineering-advanced-skills:agent-designer` |
| Database schema, migrations, queries | `engineering-advanced-skills:database-schema-designer` or `engineering-advanced-skills:sql-database-assistant` |
| Auth, encryption, credentials, OAuth flows | `engineering-skills:senior-security` or `engineering-skills:ai-security` |
| Writing or reviewing tests | `engineering-skills:tdd-guide` or `engineering-skills:senior-qa` |
| Code review before merging | `engineering-skills:code-reviewer` or `engineering-advanced-skills:pr-review-expert` |
| CI/CD, deployment pipeline | `engineering-advanced-skills:ci-cd-pipeline-builder` |
| Any bug investigation | `superpowers:systematic-debugging` |
| Adversarial pre-ship check on a risky change | `engineering-skills:adversarial-reviewer` or `engineering-skills:red-team` |

### Product & strategy
| Task touches | Skill |
|---|---|
| Feature prioritization, roadmap | `product-skills:product-strategist` or `product-skills:product-manager-toolkit` |
| Market/competitive research, audits like the Global Product & Market Revenue Audit | `product-skills:competitive-teardown`, `c-level-skills:competitive-intel` |
| Pricing decisions | `marketing-skills:pricing-strategy` |
| ICP/persona work | `product-skills:ux-researcher-designer` |
| Go-to-market planning | `c-level-skills:cro-advisor`, `marketing-skills:launch-strategy` |
| Positioning/messaging | `c-level-skills:cmo-advisor`, `marketing-skills:marketing-strategy-pmm` |
| Fundraising/investor-facing material | `c-level-skills:board-deck-builder`, `c-level-skills:ceo-advisor` |
| Cross-functional strategic decisions (build vs. sell, expansion, kill criteria) | `c-level-skills:ceo-advisor` + relevant C-level advisor for the functional area |

### Process (apply first, before the above)
| Situation | Skill |
|---|---|
| New feature, unclear approach | `superpowers:brainstorming`, then `superpowers:writing-plans` |
| Executing an already-written plan | `superpowers:executing-plans` |
| Before marking any work done | `superpowers:verification-before-completion` |

**Token discipline:** do not redo research or analysis that already exists in this project's docs (`docs/superpowers/specs/`, `docs/superpowers/plans/`) or in the market audit under `Downloads/Dex_Global_Product_Market_Revenue_Audit_2026_2031.docx`. Check first; extend or verify with new evidence rather than regenerating what's already there.

**Learning harness:** after finishing a non-trivial task in this project, if a durable project-specific pattern or gotcha was learned (not obvious from the code), record it — either as a code comment where it's non-obvious, or, for anything spanning multiple files/sessions, in `docs/superpowers/` alongside the existing specs and plans. Don't create a new note for something a future reader could derive from the code itself.

This routing table is deliberately a living document — extend it as the project's skill needs change, don't just accumulate exceptions elsewhere.

## Mandatory: senior-developer discipline, minimum tokens

Every piece of work in this project — code, docs, plans — must read like it was written by a senior engineer optimizing for the reader, not for output volume:
- No filler, no restating what the code already says, no speculative abstraction for hypothetical future needs.
- Prefer the smallest correct change. Three similar lines beat a premature shared helper.
- Before writing new code, check whether something in the codebase already does it — extend, don't duplicate.
- No wasted tokens: don't regenerate research, plans, or context that already exists on disk (see Token discipline above) — read it and build on it.

## Mandatory: file organization

Every file in this project lives in a clearly-named, purpose-scoped location — nothing loose at repo root that isn't a real root-level file (`package.json`, `README.md`, config files). Docs go under `docs/superpowers/{specs,plans}/`, matching the existing convention. Before creating a new file, check whether it belongs in an existing folder. The repo must stay navigable by path and filename alone.

## Platform-agnostic by design (decided 2026-10-02, do not re-litigate)

Dex is URL-first and platform-agnostic permanently. The differentiator is audit value with zero login. Manual apply (the customer copies the approved fix from the Proof Receipt into their own site) is the permanent model, not a stopgap until an integration exists.

- No platform-specific write-back: no Shopify, WooCommerce, WordPress or custom-CMS auto-apply. The former Gate 2 (Shopify auto-apply) is cancelled, not paused.
- Existing Shopify code under `src/app/api/shopify/*` stays as-is (its GDPR webhooks may be compliance plumbing) but gets no further investment.
- Product copy must not imply Dex writes to a customer's site.
- Reopening this needs new customer evidence that manual apply is the blocker, taken to the account owner. Record: `docs/superpowers/specs/2026-10-02-platform-agnostic-decision.md`.

## Standing goal

Dex is being built to be an award-winning, category-defining product — every phase of execution should be judged against that bar, not just "does it work." Ship quality, not just shipped.

## North star — full marketing team product

The long-term target for Dex is to evolve beyond SEO/GEO audits-and-fixes into a product that performs the full range of marketing functions for a DACH SMB with no in-house marketing hire: content, social, paid ads, email/lifecycle, PR/earned media, analytics/attribution, and positioning/pricing input, not just search visibility. SEO/GEO is the beachhead, not the ceiling.

Implications for execution, not a license to scope-creep today's tasks:
- New capability areas should be designed so GrowthGuard's approve-before-publish safety gate extends to them naturally (same pattern as today's meta/structured-data fixes), not bolted on later.
- When architecture decisions are made (data model, action/finding pipeline, agent orchestration), prefer the option that generalizes to other marketing-function types over one that only fits SEO.
- Don't build speculative infrastructure for functions not yet scoped — extend the existing finding → action → GrowthGuard → approval pipeline when a new function is actually greenlit, don't pre-build for it.
- Check `docs/superpowers/plans/` and `docs/superpowers/specs/` before assuming a given function (social, ads, email, etc.) hasn't been scoped yet — this note sets direction, not a fresh backlog.
