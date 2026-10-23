# DEX Team Architecture Assessment (Specialist A)

Date: 2026-10-02. One-shot, read-only. Sources read: `CLAUDE.md`, `package.json`, `prisma/schema.prisma`, `src/` tree, the 2026-09-23 directive and implementation inventory, `src/lib/entitlements.ts`, the approve route, and the Shopify routes. Tests and build were not re-run for this pass. Baseline facts from god are not re-derived.

## 1. Capability baseline

Classes: **V** implemented+verified (code and tests exist, shipped per project docs) · **U** implemented+unverified (code exists, no evidence read this pass) · **I** incomplete · **P** proposed · **B** blocked-external.

| Capability | Class | Evidence |
|---|---|---|
| URL-first audit and scan queue (Phase 1B) | V | `run-scan.ts`, `scan-worker.ts`, `/api/scan/*`, tests; ADR 2026-09-24 |
| SSRF-safe fetch, prompt-injection boundary (1E) | V | `safe-fetch.ts`, `ai/untrusted-data.ts`, fixtures |
| Durable generation queue (1C) | V | `GenerationJob`, `ProviderCircuitBreaker`, QStash reconcile script |
| Finding-to-action coverage (1F), 10 rule IDs | V | `deterministic-remediation.ts`, `*-fix.ts` |
| SEO/GEO/Brand specialists + ProofLayer | V | `audit-agents/`, `proof-layer.ts` |
| GrowthGuard review: approve/edit/reject/revert | V | `/api/actions/[actionId]/*`, `GuardResult`, `AuditLogEntry` |
| Content Studio, 8 platform adapters | I | Drafts and export only; inventory says the formatter is text-only, no publish API |
| **Publish/apply to a live site** | **I/P** | Approve route sets `status=approved`, captures a GSC baseline, writes an audit row. No code writes to a customer site. Shopify has OAuth and GDPR webhooks only. No WordPress code. Phase 3D/3E are proposed. The fix loop ends at human copy-paste. |
| Outcome measurement (GSC baseline, then cron) | U/B | `cron/measure-outcomes`, `gsc-client.ts`. GSC OAuth blocked: `GOOGLE_CLIENT_SECRET` mismatch needs account-owner console access (inventory) |
| Feedback to preference learning, versioned activation (8A-8D) | U | Models, libs, routes exist; no customer population yet |
| Multi-site + entitlement limit (`maxWebsites`) | V | `entitlements.ts`, serializable-transaction check |
| **Billing / pricing / payments** | **P** | No Stripe or subscription code. `maxWebsites` is a bare column with no plan tier. Billing is permanently human-gated per the directive |
| RBAC / agency roles | P | `WorkspaceMember.role` is written, never read (inventory, grep-confirmed) |
| Social, ads, email, PR functions (north star) | P | Only Content Studio drafts exist; not scoped for build |
| Marketing site / landing | U | `components/marketing/` exists; conversion not evidenced |
| Customers / revenue | P | Pre-revenue; no design-partner evidence found in the repo |

**Read:** the audit-to-reviewed-draft half is strong. The apply-to-site half and the monetization half do not exist. Further review-queue UI slices polish the strongest half and add the least marginal value.

## 2. Roster proposal: 2 owners, not 4

Pam (build) and Dwight (review) stay. Add two ownership functions. Every skill below was checked present in the installed plugin cache.

| Owner | Skill | Trigger | Dependency | Verification |
|---|---|---|---|---|
| **Product & Revenue Lead** (strategist + revenue/CS) | `product-skills:product-strategist` | Segment, scope, kill-criteria decisions | Existing docs under `docs/superpowers/` | Decision record cites a file or data source; no regenerated research |
| | `marketing-skills:pricing-strategy` | Before any billing build | Segment pick, willingness-to-pay evidence from interviews | Prices marked untested until a buyer sees them |
| | `product-skills:competitive-teardown` | Once, DACH SEO/GEO tools | Web access | Sources dated; last30days rule applies |
| | `business-growth-skills:customer-success-manager` | After the first design partner exists | A real partner | Health notes trace to usage events |
| | `ra-qm-skills:gdpr-dsgvo-expert` | Before any DACH-facing claim or data-processing change | Privacy surface list | Output is a model read, not legal advice; human counsel signs off |
| **Conversion & Growth Lead** (design/CRO + content) | `marketing-skills:page-cro` | Landing page and first-audit result page | A baseline conversion number, or an explicit "none yet" | Before/after on the funnel |
| | `marketing-skills:ai-seo` | DEX's own GEO visibility, as product proof | Live site | Own-site audit run through DEX itself |
| | `marketing-skills:copywriting` | Landing and outbound copy, German variant | `ClientProfile` brand voice | Humanizer pass; no unsupported claims |
| | `marketing-skills:customer-research` | Interview script and synthesis | Access to 5-10 DACH SMB owners | Verbatim quotes kept; counts stated |

Why two: Strategist and CS work is low-volume with no customers yet, and Design and Growth share one funnel asset. A third or fourth owner has no input stream today. Boundaries: pricing and billing stay human-gated; neither role edits `src/`, `prisma/` or `scripts/`. Build skills (`engineering-skills:senior-backend`, `engineering-skills:tdd-guide`) stay Pam's; review skills (`engineering-skills:code-reviewer`, `engineering-skills:senior-security`) stay Dwight's. One skill per job; skip near-duplicates such as `marketing-skills:cro`.

## 3. Gate-1 / Gate-2 recommendation

**Segment (hypothesis, untested):** DACH single-site e-commerce SMBs on Shopify, run by an owner-operator or one marketer. Shopify OAuth and compliance webhooks already exist, `restricted_wording_fix` and `structured_data_fix` fit product-page problems, and GDPR-conscious buyers value approve-before-publish.

**Gate 1: honest value, no integration risk (shortest credible).**
- Journey: URL-only audit (no Google login) → Opportunity Board → one approved draft → Proof Receipt → owner applies the change by hand.
- Exit: 3 to 5 real DACH shop owners run an audit on their own site; at least 2 approve a draft and say they would apply it. Evidence comes from interviews, not new code.
- Not required: GSC, billing, RBAC, publishing.
- Parallel fix: the GSC secret mismatch (account-owner console action). It gates outcome evidence, not Gate 1.

**Gate 2: one change applied and verified on a live site.**
- Journey: Shopify connect → approve one meta or structured-data fix → apply → refetch → verify → tested revert (Phase 3D/3E, Shopify only; no WordPress, batch or RBAC).
- Exit: one design-partner shop with a recorded apply, a verified refetch, and one tested revert.
- Precondition: a writable Shopify dev store. The 3D ADR requires a test destination; without one, stop at the connector contract.
- Defer billing until a partner states a price. Price first via `pricing-strategy` plus interviews, then Stripe.

**Not recommended now:** more review-queue UI slices, Phase 2 visual work, RBAC (3A), agency portfolio (3B), and social/ads/email functions. No customer is pulling for any of them yet.

## 4. Open risks

1. No revenue or customer evidence in the repo; the segment pick is untested.
2. Apply-to-site is the "growth agent" promise yet absent; marketing copy must not imply it.
3. The GSC blocker is external and has no owner or date.
4. Gate-1 interviews need the human founder; agents cannot recruit buyers.
