# DEX Hive: Skills and Efficiency Audit (Specialist B)

Date: 2026-10-02. Independent one-shot. Did not read Specialist A. Sources: `hive/agents/worker-dex-{pam,dwight}/{memory.md,identity.md,settings.json}`, installed skill list, DEX specs.

## 1. Pam and Dwight: skill and capability audit

Evidence base is thin: one slice (66b9f13 plus fixup 8d69226) and one review. Neither agent's memory records a single Skill-tool invocation.

| Finding | Detail |
|---|---|
| Unexercised skill claim (Dwight) | Memory lists code-reviewer, pr-review-expert, adversarial-reviewer, senior-security. His one review shows manual vitest, build, tsc and a customerId-scoping check. No skill use recorded. adversarial-reviewer and senior-security were declared for "auth/credentials/prompt-injection" work and have not triggered yet, so those are intent, not exercised. |
| Unexercised routing (Pam) | Project CLAUDE.md mandates skill routing (senior-frontend/backend, tdd-guide, verification-before-completion). Pam's memory records none. The slice was small, but "routed" cannot be verified from memory. Ask for skill names in each done message. |
| Capabilities field | Both identities say `Capabilities: —`. Nothing was claimed there, so nothing false to flag. |
| Role overlap | Both run vitest, build and tsc. For Dwight this is deliberate independent re-verification. Real overlap is the checkout: Dwight works in `/Users/surya/Projects/dex-ai`, the human's dirty primary checkout. Pam has her own worktree. A reviewer on a dirty tree can mask or invent diffs. Prefer reviewing `git show <sha>` from a clean worktree. |
| Tool breadth | Identical MCP set on both: sequential-thinking, time, fetch, context7, filesystem, git. Dwight's "read-only" is self-enforced policy, not a tool restriction (he has Edit/Write and git MCP). Fetch is unneeded for both on current work. Filesystem MCP duplicates native Read/Write. Both need `dangerouslyDisableSandbox` for `next build` (`.next/trace` EPERM), a known routine cost. |
| Token efficiency | ~$4 (Pam) and ~$2 (Dwight) for one small UI filter plus one review. Review cost half the build. Acceptable, but a full Sonnet reviewing a 2-file diff is where a cheaper model would first pay off. |

## 2. Proposed roles: model tier

Rule: cheap/fast model only if output is checkable by a script or a human gate and errors are cheap. Anything that sets direction, makes claims about real customers, or guards security needs full reasoning.

| Role | Tier | Why |
|---|---|---|
| Product/Market Strategist | Full | Trade-off judgment, evidence weighing, kill criteria. Errors compound into roadmap. Project rule says extend existing audit, don't regenerate; cheap models tend to regenerate. |
| Design/Conversion Lead | Full for decisions, cheap for execution | CRO diagnosis and taste calls need reasoning. Applying approved copy, spacing tokens and impeccable findings can run cheap. Split the role. |
| Growth/Content Lead | Cheap for drafting, full for review | Content is approve-before-publish gated (GrowthGuard), so draft errors get caught. Meta rewrites, variants and calendars are bounded. Positioning and DACH-claim accuracy stay full. |
| Revenue/Customer-Success Lead | Cheap, bounded | Mostly lookup, summaries and templated outreach. Hard limits: no pricing decisions, no unverifiable customer claims. Escalate pricing to Strategist. |
| Independent Quality/Security/Measurement Lead | Full | Must catch what the builder missed. A weaker reviewer than the builder is theatre. Security (Clerk, tenant scoping, prompt injection) is the worst place to save tokens. Measurement can be cheap only for scripted checks. |

Net: only Revenue/CS and Growth drafting are safe on a cheap model today. Model is fixed at spawn via `spawn-requests/<id>.json` `model`; a running agent cannot be downshifted.

## 3. Skill-provenance checklist for god

Verified present in the installed list this session:
`engineering-skills:code-reviewer`, `engineering-advanced-skills:pr-review-expert`, `engineering-skills:adversarial-reviewer`, `engineering-skills:senior-security`, `engineering-skills:ai-security`, `engineering-skills:senior-frontend`, `engineering-skills:senior-backend`, `engineering-skills:tdd-guide`, `engineering-skills:senior-qa`, `superpowers:verification-before-completion`, `superpowers:systematic-debugging`, `marketing-skills:cro`, `marketing-skills:analytics`, `product-skills:cs-product`, `c-level-skills:company-os`, `taste-skill:gpt-tasteskill`.

Apply to any name Specialist A or god proposes:
1. Exact string match against the installed list, plugin prefix included. Bare `cro` is ambiguous (`marketing-skills:cro` vs `marketing-skills:page-cro`).
2. Check duplicate families (`marketing-skills:analytics` vs `analytics-tracking`; `ecc:code-review` vs `code-review`). Pick one and name it.
3. Name must match function. `ecc:*` and `claude-ads:*` are not engineering skills. Reject loose paraphrases like "senior reviewer".
4. Spawned workers may not load this session's skill set. Confirm the worker profile loads the plugin before assigning a skill. Pam and Dwight memory only references names, never confirms loading.
5. Require proof in the done message: skill invoked, one line on what it changed.

## 4. Token ceilings

- 1.5M per specialist is loose for this task class. This audit needs roughly 100-200k. A one-shot above ~500k means looping or re-deriving existing docs.
- Real spend so far is ~$4 and ~$2 for shipped work, so 1.5M of full Sonnet does not bound cost meaningfully.
- Recommend 400-600k for one-shot specialists and about 600k for the reviewer. Keep 1.5M only for the engineer (Pam). Add a "stop and report partial at 70% of cap" rule alongside the circuit breaker.
- Not too tight anywhere. Context occupancy (`ctx %`) is the binding constraint, not cumulative tokens.

## Caveat

Findings rest on two memory files and one review cycle. Reassess after Pam's second slice and Dwight's first security-relevant review.
