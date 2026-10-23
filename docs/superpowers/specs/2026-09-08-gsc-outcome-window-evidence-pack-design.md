# GSC Outcome-Window Linking + Evidence Pack Export — Design

Phase 5 of `docs/superpowers/plans/2026-09-08-assurance-loop-foundation.md` (depends on Phase 1, 2, 3 — all shipped).

## Problem

Once a customer approves or edits an AI-drafted meta description, Dex has no way to show whether the change actually helped. There's also no way to hand a client or stakeholder proof that a specific change was safety-checked and measurably worked. This phase adds both: automatic before/after Google Search Console (GSC) measurement per decided action, and a downloadable PDF evidence pack per action.

## Scope decisions (confirmed with the founder)

- **Trigger mechanism:** Vercel Cron, not a manual button. A new scheduled job measures outcomes automatically; the customer does nothing.
- **Window length:** 28 days, reusing the constant already established in `src/lib/gsc-client.ts:28` for the existing scan/flagging flow — not a new arbitrary number.
- **Evidence pack format:** a real downloadable PDF (not a printable HTML page, not JSON/CSV), via `@react-pdf/renderer` — pure JS, no headless browser, fits Vercel serverless functions without a Chromium binary layer (which Puppeteer would require).

## Architecture

Two independent additions on top of the existing `Action` model, no new tables:

1. **Baseline capture** — when an action is approved or edited, Dex fetches the page's current 28-day-trailing GSC performance and stores it on the `Action` as the "before" snapshot.
2. **Outcome cron** — a daily Vercel Cron job finds actions whose 28-day post-decision window has closed and fetches the *next* 28 days of GSC performance for that page (day 0-28 after `decidedAt` vs. the pre-existing day (-28)-0 baseline — two adjacent, non-overlapping, equal-length windows, not "GSC's rolling 28 days as of today"). Stores the "after" snapshot.

The evidence pack PDF reads both snapshots (when present) plus the existing diff (`computeDiff`, from Phase 3) and ProofLayer result, and renders one document per action.

## Data model

Four new nullable fields on `Action` (one migration):

```prisma
model Action {
  // ...existing fields...
  baselinePerformance Json?      // { impressions, clicks, ctr } as of decidedAt, 28-day trailing
  baselineCapturedAt  DateTime?
  outcomePerformance  Json?      // { impressions, clicks, ctr } for the 28 days after decidedAt
  outcomeMeasuredAt   DateTime?
}
```

All four stay `null` until decided (baseline) or until the window closes (outcome) — pure additive fields, matching how Phase 2 added `riskTier`/`policyVersion`. No backfill for existing rows: an action decided before this ships simply never gets `baselineCapturedAt` set, so the cron never picks it up. That's correct — there's no historical baseline to compare against for those rows.

## `gsc-client.ts` changes

The existing `queryPagePerformance` hardcodes `startDate`/`endDate` to "28 days ago through today." Generalize it to accept an explicit range, and make `listPagePerformance` a thin wrapper over the new function with that same default range — so the existing scan/flagging caller (`src/lib/run-scan.ts:50`) is untouched.

```typescript
export async function getPagePerformanceForRange(
  refreshToken: string,
  siteUrl: string,
  startDate: string,  // YYYY-MM-DD
  endDate: string      // YYYY-MM-DD
): Promise<PagePerformance[]>

export async function listPagePerformance(refreshToken: string, siteUrl: string): Promise<PagePerformance[]> {
  const end = new Date();
  const start = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return getPagePerformanceForRange(refreshToken, siteUrl, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
}
```

A new helper extracts a single page's row (or zeros, if the page had no impressions in that window — not an error):

```typescript
export function findPagePerformance(performance: PagePerformance[], pageUrl: string): Omit<PagePerformance, 'url'> {
  const match = performance.find((p) => p.url === pageUrl);
  return match ? { impressions: match.impressions, clicks: match.clicks, ctr: match.ctr } : { impressions: 0, clicks: 0, ctr: 0 };
}
```

## Baseline capture (approve/edit routes)

Both `src/app/api/actions/[actionId]/approve/route.ts` and `.../edit/route.ts` gain a GSC fetch before their existing transaction, folded into the same `db.action.update` call (not a second update on the same row):

`gscRefreshToken` is stored encrypted (`src/lib/crypto.ts`'s `decrypt`/`encrypt`), same as `run-scan.ts:48` already does — never pass the raw DB value to `gsc-client.ts`.

```typescript
let baselineFields: { baselinePerformance: Prisma.InputJsonValue; baselineCapturedAt: Date } | Record<string, never> = {};
if (customer.gscRefreshToken) {
  try {
    const performance = await listPagePerformance(decrypt(customer.gscRefreshToken), customer.websiteUrl);
    baselineFields = {
      baselinePerformance: findPagePerformance(performance, action.pageUrl),
      baselineCapturedAt: new Date(),
    };
  } catch {
    // GSC call failed (revoked token, transient API error, etc.) — approve/edit still succeeds,
    // baseline stays null, and this action is simply never picked up by the outcome cron.
  }
}
// customer.gscRefreshToken null (never connected GSC) — same result, baselineFields stays empty.
```

The `reject` route is untouched — a rejected draft has no outcome to measure.

## Outcome cron

New route: `src/app/api/cron/measure-outcomes/route.ts` (`GET`). New file: `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/measure-outcomes", "schedule": "0 6 * * *" }]
}
```

Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations. The route checks that header against `process.env.CRON_SECRET` and returns 401 on any mismatch (including the header being absent, which covers a stray manual `curl`). `CRON_SECRET` is added to `.env.example` as a placeholder and set as a real Vercel environment variable — never committed with a real value.

Logic:

```typescript
const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
const candidates = await db.action.findMany({
  where: {
    status: { in: ['approved', 'edited'] },
    baselineCapturedAt: { not: null, lte: cutoff },
    outcomeMeasuredAt: null,
    customer: { gscRefreshToken: { not: null } },
  },
  include: { customer: true },
});

let succeeded = 0;
let failed = 0;
for (const action of candidates) {
  try {
    const windowStart = action.baselineCapturedAt!;
    const windowEnd = new Date(windowStart.getTime() + 28 * 24 * 60 * 60 * 1000);
    const performance = await getPagePerformanceForRange(
      decrypt(action.customer.gscRefreshToken!),
      action.customer.websiteUrl,
      windowStart.toISOString().slice(0, 10),
      windowEnd.toISOString().slice(0, 10)
    );
    await db.action.update({
      where: { id: action.id },
      data: {
        outcomePerformance: findPagePerformance(performance, action.pageUrl),
        outcomeMeasuredAt: new Date(),
      },
    });
    succeeded++;
  } catch {
    failed++; // one customer's revoked token doesn't fail the whole run
  }
}

return NextResponse.json({ processed: candidates.length, succeeded, failed });
```

## Evidence pack PDF

New file `src/lib/evidence-pdf.tsx` using `@react-pdf/renderer`'s `Document`/`Page`/`View`/`Text` primitives and `renderToBuffer`. Content, top to bottom:

1. Page URL, decision type (Approved/Edited), decision date.
2. "What changed" — the diff from `computeDiff(action.currentValue ?? '', action.draftContent)`, rendered as inline text runs colored with the literal brand hex values (`#10b981` for added, `#f87171` strikethrough for removed — `@react-pdf/renderer` styles can't read CSS custom properties, so these are the same tokens' concrete values, not new colors).
3. ProofLayer result — outcome (pass/flag), risk tier, and the list of checks run with pass/fail.
4. GSC outcome — if `outcomeMeasuredAt` is set: a before/after table (impressions, clicks, CTR) plus the computed delta (absolute and percentage) for each metric. If not yet measured: "Outcome measurement pending — available 28 days after this decision."

New route `src/app/api/actions/[actionId]/evidence/route.ts` (`GET`): same Clerk-auth-then-customer-ownership pattern as every other action route (401/404 identically), calls `renderEvidencePdf(action, guardResult, checksRun)`, returns:

```typescript
return new Response(pdfBuffer, {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="dex-evidence-${action.id}.pdf"`,
  },
});
```

## UI

Review detail page (`src/app/review/[actionId]/page.tsx`) gets a "Download evidence pack" button inside the existing `isFinal` block (approved/edited only — same gate as the "Ready to apply" copy block), linking to `/api/actions/${action.id}/evidence`. Not shown for `rejected` or `pending` — nothing to report on a draft that was never applied.

## Testing

- `getPagePerformanceForRange`/`findPagePerformance`: pure functions, unit-tested with mocked GSC responses (reuse the existing `gsc-client.test.ts` mocking pattern).
- Baseline capture: extend `approve/route.test.ts` and `edit/route.test.ts` with a case asserting `baselinePerformance`/`baselineCapturedAt` are set on success, and a case asserting the route still succeeds (200/307) when the GSC fetch throws.
- Cron route: mocked-Prisma test asserting the `where` clause shape, the per-action try/catch isolation (one throwing action doesn't stop the loop), and the 401 on a missing/wrong `Authorization` header.
- `evidence-pdf.tsx`: a smoke test — `renderEvidencePdf(mockAction, ...)` resolves to a non-empty `Buffer` whose first bytes are the `%PDF` magic number. Not a pixel-level rendering test.
- `evidence/route.ts`: mocked-Prisma test for 401/404 (matching sibling routes) and a 200 with the correct `Content-Type`/`Content-Disposition` headers (PDF generation itself mocked to return a fixed buffer).

## Out of scope (deferred)

- Multi-action / period evidence reports (this phase is one PDF per action, matching the existing per-action page pattern).
- Any manual "measure now" trigger — cron-only, per the confirmed decision above.
- Historical backfill of baselines for actions decided before this ships.
