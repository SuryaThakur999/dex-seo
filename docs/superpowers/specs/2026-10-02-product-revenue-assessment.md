# DEX Product & Revenue Assessment

Date: 2026-10-02. Author: Angela (Product & Revenue Lead). Read-only on `src/`, `prisma/`, `scripts/`. Baseline not re-derived: `2026-10-02-dex-team-architecture-assessment.md`, `2026-08-14-dex-ai-strategy-design.md`, `docs/gtm/first-customer-playbook.md`. Product decision taken today: Shopify write-back dropped, URL-first and platform-agnostic, manual copy-paste apply is permanent. DEX is pre-revenue with no design partner, so every claim below is a hypothesis.

## 1. Segment: broaden, but lead with one wedge

**Recommendation: drop "Shopify owners" as the anchor. Anchor on "DACH owner-operated SMB with a public website and no marketing hire", and pick one wedge inside it for the first 5 interviews.**

Reasoning:
- The Shopify anchor rested on three things: OAuth, write-back, and product-page fit. Write-back is gone, so Shopify no longer buys any access advantage. The product now needs only a URL.
- URL-first means the product serves any site equally. Narrowing to Shopify now only shrinks the reachable buyer pool and adds a platform-specific funnel (App Store, theme quirks) the product no longer uses.
- Manual apply is permanent, so the buyer's platform changes how they paste, not whether DEX works. Shopify, WooCommerce, WordPress, Webflow and hand-built sites all take a meta tag or JSON-LD snippet.
- Counterpoint kept: broadening dilutes messaging. The 2026-08-14 strategy already named two segments (A: founder-led B2B SaaS/tech SMB; B: shop owners). Both are still valid. What changes is that platform stops defining the segment. Business type does.

Decision for Gate 1: recruit interviewees from both A and B, tag each by business type, and let the first 5 to 10 conversations show which converts. Do not pre-commit to either. Shopify stays as one interview filter, not the positioning.

Risk to flag: "no marketing hire" is the real qualifier, and it is untested. A buyer who does their own SEO may not want drafts they must paste by hand. Ask directly in interviews how much effort the copy-paste is, and whether they would do it weekly.

## 2. DACH SEO/GEO competitor snapshot

Retrieved 2026-10-02 via web search. Freshness rule applied: items dated before 2026-09-02 or undated are marked and not used as evidence. **Caveat: every price below comes from third-party comparison blogs, not vendor pricing pages. Verify on vendor sites before any pricing decision.** I did not fetch vendor pages in this pass.

| Tool | What it does | Price signal (secondary source) | Date status |
|---|---|---|---|
| Sistrix | SEO suite plus AI Visibility prompt tracking, Bonn-based | AI Visibility from about EUR 119/mo (100 to 1,500 prompts); SEO modules about EUR 99/mo each | Undated blog roundups. Indicative |
| Peec AI | AI visibility monitoring, Berlin | From about EUR 70/mo annual (50 prompts); one source says EUR 89 | Undated. Indicative |
| Otterly.AI | AI visibility monitoring, Austria | Lite $29, Standard $189, Premium $422 to $489 (annual), Enterprise $1,000 | One source updated 2026-07-28 (stale, discarded). Others undated |
| Rankscale | AI visibility monitoring | $20 / $49 / $99+ | Undated. Indicative |
| Onclusive GEO Analytics | PR-side GEO analytics | From about $105/mo | Pricing seen as of 2026-09-29. Only in-window item found |
| Search Atlas / OTTO, Okara | Monitoring plus execution with approval and rollback (from the 2026-08-14 strategy doc) | Not re-checked | Carried over, not refreshed |

What this says, with confidence labeled:
- **Monitoring is cheap and crowded.** Entry prices cluster at roughly EUR 20 to 120/mo. Medium confidence, secondary sources only.
- **No tool found that audits a URL, drafts the fix, gates it, and hands the owner a ready paste.** This matches the strategy doc's claim but I did not verify it exhaustively. Low to medium confidence.
- **DEX should not price like monitoring.** Competing on prompt counts against Peec or Rankscale is a losing frame. The value is the drafted, reviewed fix.
- Gap in this pass: no in-window vendor announcements for Sistrix, Peec or Otterly surfaced. Re-run `/last30days` with vendor sites fetched directly before citing any of this externally.

## 3. Pricing hypothesis (UNTESTED until a buyer sees it)

**Status: hypothesis. No buyer has seen any number. No billing or Stripe work is implied. Pricing stays human-gated per the directive.** `Customer.plan` defaults to `"free"` and `maxWebsites` is a bare column, so no tier structure exists in code either.

Value metric candidate: **per website, per month**, drafts included. It matches how `entitlements.ts` already limits sites and how the buyer thinks ("my shop"). Prompt-count metrics belong to monitoring tools.

| Tier (hypothesis) | Sites | Offer | Anchor price to test |
|---|---|---|---|
| Free audit | 1 | URL audit, findings list, no drafts | EUR 0 (lead capture) |
| Core | 1 | Weekly scan, drafts, review queue, proof receipt | EUR 49 to 79 / mo |
| Plus | up to 3 | Core, more sites, priority generation | EUR 129 to 179 / mo |

Why these numbers: they sit above monitoring-only tools (EUR 20 to 120) because DEX produces fixes, and below the agency retainers the strategy doc cites (64% under $1,000/month). That is an inference from competitor ranges and one agency stat, not buyer evidence.

How to test, in order:
1. In interviews, ask for willingness to pay before showing any number. Use open questions first, then Van Westendorp (too cheap, cheap, expensive, too expensive).
2. Show the Core price only after the buyer has seen an approved draft.
3. The first-customer playbook already says "working out pricing with the first few customers directly." Keep that until 3 or more buyers give a price.
4. Kill criterion: if fewer than 2 of 5 say they would pay anything for drafts they must paste themselves, revisit the product shape before touching pricing.

Open question for the human: whether to offer a founding-customer discount in exchange for interview time. Not decided here.

## 4. GDPR / DSGVO posture (read-only model audit, not legal advice)

I read the Shopify webhook routes, `prisma/schema.prisma`, and the AI client list. I did not run the app or read production data. **This is a model's read of the repo. A qualified German or EU privacy lawyer must sign off before any DACH-facing privacy claim.**

What the code shows:
- **Shopify compliance webhooks exist and verify HMAC.** `customers-redact` and `customers-data-request` return 200 and do nothing, with a code comment that DEX stores no merchant customer data. `shop-redact` nulls `shopifyShopDomain` and `shopifyAccessToken` on matching `Website` rows. That matches the comment, judging by the schema.
- **Data DEX holds, by schema:** `Customer.clerkUserId` (identity lives in Clerk), `ClientProfile.businessDescription` and brand fields, `Website.url`, GSC refresh token, page content hashes (`PageSnapshot` stores a hash, not page text), `Finding`, `Action`, `AuditLogEntry`, `ContentPiece`.
- **Third-party processors in play:** Clerk (auth), Groq (generation, via OpenAI SDK, `src/lib/openai-client.ts`), Vercel (hosting), Upstash QStash (queue), Google (Search Console), Shopify (OAuth, now being dropped). The database host was not identified in this pass.

Flags needing real counsel or a human decision (not resolved by guess):
1. **No privacy policy, Impressum or DPA surface found in `src/app`.** A grep for datenschutz/impressum/AVV returned only unrelated hits. A DACH commercial site needs an Impressum (German law) and a privacy notice. Confirm whether they exist elsewhere, for example on a marketing domain.
2. **Processor agreements.** Whether DPAs and SCCs are in place with OpenAI, Vercel, Clerk and Upstash, and whether data is processed in the EU or the US, is not visible in the repo. Counsel question.
3. **Data sent to OpenAI.** Customer site content and `businessDescription` go into prompts. The prompt-injection boundary (1E) is a security control, not a transfer-legality control. Counsel question: transfer basis, retention, training opt-out settings.
4. **Retention and deletion.** The only deletion path found is `shop-redact`. No account-deletion or data-export flow found for `Customer`, `Action`, `AuditLogEntry` or `ContentPiece`. With Shopify dropped, an Art. 15 or Art. 17 request has no code path. Engineering item for Pam, legal wording for counsel.
5. **Shopify code becomes dead weight.** If Shopify OAuth is removed, the token columns and webhooks need a deliberate decommission, and stored tokens must be purged. Flag to Pam. Keep the endpoints while the Shopify app is listed, since Shopify requires them for installed apps.
6. **Marketing claims.** Keep the 2026-08-14 rule: no "DSGVO-compliant" or "ensures compliance" wording. "GDPR-first architecture" only after counsel agrees it is defensible.
7. **Third-party personal data in scanned pages.** Scanned pages may contain names or emails. The strategy doc calls the exposure minimal, which is plausible but untested. Counsel question for processing-agreement scope.

Not assessed: cookie consent on DEX's own pages, the EU AI Act beyond the 2026-08-14 MINIMAL-tier triage, Clerk and OpenAI contract terms.

## 5. Blocked: customer success

`business-growth-skills:customer-success-manager` work is **blocked**. It needs a real design partner and none exists. No health scores, usage data or customer quotes have been or will be invented. Unblock condition: the human recruits real DACH shop or SMB owners (hive board item `dex-new-roles-defined-not-spawned`).

## 6. Next actions (none executed)

1. Human: recruit 5 to 10 DACH owners across segments A and B for Gate 1.
2. Human: fetch vendor pricing pages directly for Sistrix, Peec, Otterly and Rankscale before quoting any competitor price.
3. Human: engage privacy counsel on flags 1 to 4 before any DACH-facing launch.
4. Pam (build lane, not mine): account deletion and export path; Shopify decommission plan.
