# Implementation Inventory — Source of Truth

Maps every conceptual system named in the marketing-operator directive to the real code that already exists. Compiled from direct inspection this session (schema, routes, and lib files actually read), not from a prior session's summary. Column 5 states what Phase 1-3 slice work needs, if anything.

| Conceptual system | Real source of truth | Current route/service | Reusable as-is | Needs adapter | Blocked externally |
|---|---|---|---|---|---|
| Tenant hierarchy | `Customer` → `ClientProfile` → `Website` (Prisma models) | `src/lib/customer.ts` (`resolveWebsiteForRequest`, `ensureCustomer`) | Yes | — | — |
| Authentication | Clerk (`@clerk/nextjs`) | `auth()` in every route handler | Yes | — | — |
| GSC connection | `Website.gscRefreshToken`/`gscPropertyUrl`/`gscReconnectRequired` | `src/lib/gsc-client.ts`, `/api/websites/[id]/confirm-url` | Partial | Needs 1A OAuth-taxonomy fix | **Yes** — `GOOGLE_CLIENT_SECRET` in Vercel doesn't match Google Cloud Console's active secret (root-caused, documented, needs account-owner console access) |
| URL-only audit | `enqueueScanIfNeeded`/`claimAndRunScanJob` | `POST /api/scan` | Yes | — | — |
| SSRF-safe fetch | `safeFetch` (DNS-rebinding-safe pinning, private/loopback/metadata blocking) | `src/lib/safe-fetch.ts` | Yes | — | — |
| Scan jobs/events | `ScanJob`, `ScanLogLine` models | `/api/scan/process` (cron sweep), `/api/scan/[jobId]`, `/api/scan/[jobId]/cancel` | Partial | **Yes — 1B target**: runs inline within one request today (`maxDuration=300`), no durable job survives a dropped connection beyond the cron-sweep safety net | — |
| Findings/Opportunity Board | `Finding` model, `computeOpportunityGroups` | dashboard page | Yes | — | — |
| Agent orchestration | SEO/Brand/Content Specialist + ProofLayer Validator, normalized via agent-result pattern | `src/lib/*-specialist.ts`, `src/lib/proof-layer.ts` | Yes | — | — |
| Action review lifecycle | `Action` model, `ActionStatus` enum | `/api/actions/[actionId]/{approve,reject,edit,revert,retry-draft,evidence}` | Yes | — | — |
| Content Studio | `ContentPiece` model, 8 platform adapters | `src/lib/content-studio/adapters/`, `/api/content-studio/drafts/*` | Yes | — | — |
| Audit history | `AuditLogEntry` model | `src/lib/audit-log.ts` | Yes | — | — |
| Outcomes/measurement | `computeOutcomesSummary`, `computeMeasurementJourney`, `buildOutcomesEvidenceRows` | dashboard Outcomes tab | Yes | — | — |
| Feedback analysis | `FeedbackAnalysis` model | `src/lib/feedback-analysis.ts`, `/api/websites/[id]/feedback-analysis` | Yes | — | — |
| Preference candidate → evaluate → activate → rollback | `PreferenceCandidate`, `PreferenceCandidateCheck`, `PreferenceEvaluation`, `PreferenceEvaluationCase` models | `src/lib/preference-candidates.ts`, `preference-evaluation.ts`, `preference-activation.ts`; `/api/preference-candidates/[id]/{decide,activation}` | Yes | — | — |
| Brand/content preferences | `ClientProfile.{brandVoice,audience,approvedClaims,restrictedWording,markets,languages}` | `/settings` | Yes | — | — |
| Roles | `WorkspaceMember.role` (written on signup, **never read anywhere** — confirmed by grep this session) | — | No | **Yes — 3A target**: real RBAC feature, not a label change | — |
| Live Site Graph | `PageLink` model | dashboard page | Yes | — | — |
| Publishing adapters | Shopify only (`connect`, `webhooks/{customers-data-request,customers-redact,shop-redact}`) — **no WordPress code exists at all** | `/api/shopify/*` | Partial | **Yes — 3D target**: Shopify has a real head start over WordPress for the ADR | — |
| OpenAI client / rate-limit handling | `src/lib/openai-client.ts` (shared factory, `maxRetries: 2`, `isRateLimitError`) — shipped 2026-09-22 | 5 call sites | Partial | **Yes — 1C target**: no persisted circuit breaker yet (correctly deferred, see directive's Circuit Breaker Rule) | — |
| Customer-safe error taxonomy | `src/lib/customer-safe-error.ts` — generic + rate-limit-specific messages exist | 4 write sites | Partial | **Yes — 1A target**: needs the fuller error-class taxonomy the directive asks for (`invalid_client`/`redirect_uri_mismatch`/`access_denied`/`invalid_grant`/missing-property/expired-token/provider-outage), currently only classifies OpenAI 429 vs generic | — |
| Nav/theme/mobile | Light/Dark/System theme tokens, `IconRail`/`BottomNav` | `src/app/globals.css`, `src/components/app-shell/` | Yes | — | — |
| Brand mark | `DexSignalMark` component, now backed by `public/brand/dex-mark.png` (shipped 2026-09-21) | nav rail, scan-complete badge, favicon, marketing nav | Yes | — | — |

## Not yet inspected in this pass (defer to the relevant slice)

- Full test suite file-by-file mapping to acceptance criteria — defer to each slice's own focused-test selection.
- Exact `AuditLogEntry.detail` JSON shape per `eventType` — defer to 1D's evidence-identity work, which reads it directly.
- `ContentPiece` platform-adapter internals beyond the export-formatter (already confirmed text-only, no publish API) — defer to 3D's publishing-integration ADR.

## Explicit non-duplication commitments

Per the directive's reuse map: no second audit/review/drafting pipeline, no second brand-preference store, no second evidence-identity system unless a stable historical receipt can't otherwise be reconstructed. Any slice proposing a new table or route that overlaps a row above must justify why the existing one is unsuitable, in the slice's own proposal, before Agent A implements.
