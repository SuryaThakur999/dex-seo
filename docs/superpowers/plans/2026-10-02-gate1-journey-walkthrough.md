# Gate-1 journey walkthrough (2026-10-02)

Journey under test (from `docs/superpowers/specs/2026-10-02-dex-team-architecture-assessment.md`): URL-only audit with no Google login, then Opportunity Board, one approved draft, Proof Receipt, and manual apply. Manual apply is the permanent model (`2026-10-02-platform-agnostic-decision.md`).

## How it was walked, and what wasn't

- **Live, logged out, against production** (`dex-ai-plum.vercel.app`): landing, `/sign-up`, `/sign-in`, and the protected-route redirects.
- **In code, signed in:** every step from first sign-in to the copyable fix, reading the actual route and page code in order.
- **Not walked live while signed in.** No test account or session was available to the agent, and running a real audit on production spends model tokens and writes rows. Before any shop-owner demo, a human should run the journey once on production with a fresh account.

"URL-only" means no Google connection, not no account. The 2026-09-12 URL-first spec's goal is "A signed-in customer enters any public URL", so Clerk sign-up is intended.

## The journey as a new user actually meets it

1. Landing page, "Get started", Clerk sign-up, redirect to `/dashboard`.
2. `ensureCustomer` creates the workspace on the placeholder URL `https://example-pending-setup.com`. The 2026-09-12 spec treats that placeholder as a legacy-row case, but every new sign-up still takes this path.
3. Dashboard shows "Confirm this website's URL in Settings before Dex can audit it" and sends the user to Settings.
4. Settings: enter URL, "Confirm URL".
5. Dashboard (after the fix below): run the audit with no Google connection. Findings land on the Opportunity Board and drafts go through the generation queue into Review.
6. `/review/[actionId]`: approve. No Google baseline is captured, and approve still succeeds.
7. The same page shows "Ready to apply": per-type apply instructions, a copy button, and "Download evidence pack" (PDF). With no Google data, the PDF omits the outcome section rather than inventing one. No page is named "Proof Receipt"; this block plus the PDF is what the journey calls one.

## Bugs found and fixed (this slice)

| # | Bug | Fix |
|---|---|---|
| 1 | Settings told a brand-new user "we have example-pending-setup.com from when it was added", a domain they never typed. | When the host is the placeholder, the copy reads "Enter your website's URL to start auditing it. No Google account needed." (`src/app/settings/page.tsx`) |
| 2 | "Confirm URL to start auditing it" redirected back to Settings, so the user had to find the dashboard themselves to start the audit. | `confirm-url` now redirects to `/dashboard/<id>`, where the audit control is. Test updated. |

## Friction found, not fixed (bigger than a bug fix)

- **First run detours through Settings.** Steps 3 and 4 above. An inline URL field on the empty dashboard would remove a page hop, but that is a UX change, not a bug.
- **Production auth runs on a Clerk development instance** (`*.clerk.accounts.dev`, handshake reason `dev-browser-missing`). Clerk's sign-in UI shows a development-mode badge, which is a bad first impression for a shop owner. Moving to a production instance needs the account owner and a domain.
- **Landing-page testimonials name people** ("Jonas Wilhelm", "Malte Ohlendorf"). The assessment found no customers or design partners. If these are placeholders, presenting them to DACH shop owners is a credibility risk and likely a UWG problem (fake reviews). This needs a human content decision.
- **`confirm-url` validation errors return raw JSON** to a plain HTML form. Browser `required`/`type="url"` validation catches the common cases first, so only the placeholder-URL and race cases show it.
- **The filter is lost after approve/reject from `/review/[actionId]`.** Carried over from the 2026-10-02 review-filter slice.

## Verified correct along the way

- Marketing copy doesn't claim Dex writes to customer sites ("Nothing publishes without you"; apply instructions say "Dex doesn't write directly to your CMS").
- The scan route has no Google requirement. Approve and the evidence PDF both handle a missing Google baseline honestly.
- Logged-out document requests to `/dashboard` and `/review` redirect to Clerk sign-in. The 404 a plain `curl` sees is Clerk's response to non-document requests, not a bug.
