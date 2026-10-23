# Phase 2A: Journey & Information Architecture

**Status:** Design-only audit. No implementation, no code changes. Reference: `2026-09-23-dex-verified-ai-marketing-operator-directive.md`, visual pack `docs/superpowers/design-references/precision-mission-control/`.

---

## Route Audit

**Current (verified from `src/app`):**
- `/` — login redirect or home entry (no page.tsx, uses root layout + Clerk)
- `/dashboard` — website list; `/dashboard/[websiteId]` — website detail with URL entry
- `/review` — action queue list; `/review/[actionId]` — action detail + proof + decision
- `/studio` — content creation and export preview
- `/settings` — workspace, integrations, theme, preferences
- `/sign-in`, `/sign-up` — Clerk auth

**Gaps (per reference pack):**
- `/analytics` — audit coverage and honest measured-data hierarchy (ref: `02-analytics.png`)
- `/outcomes` — outcomes with evidence; GSC data states (ref: `05-outcomes.png`)

---

## Journey Mapping: 10-Stage Loop → Screens

Core loop (directive `2026-09-23`): **Observe → Prioritize → Prepare → ProofLayer → Approve → Execute → Verify → Measure → Learn → Undo**

| Stage | Route | User Action | Data Source |
|---|---|---|---|
| **Observe** | `/dashboard` (initial) → `/dashboard/[id]` | Enter URL, trigger audit | `ScanJob`, `ScanLogLine` → terminal narration + findings |
| **Prioritize** | `/dashboard/[id]` (findings bar) | View grouped findings (live, after audit) | `Finding`, `GuardResult` → Opportunity Board (grouped by severity/evidence/scope) |
| **Prepare** | `/studio` | Draft content fix + preview | `ContentPiece`, `PreferenceCandidate` + platform adapters |
| **ProofLayer** | `/review/[actionId]` | Review evidence, confidence, blocked state | `Action`, `Finding.evidence`, `GuardResult.outcome` (ProofOutcome: pass/flag/block) |
| **Approve** | `/review/[actionId]` (decision UI) | Accept/edit/reject draft | `Action.status` (ActionStatus enum) + `Action.decidedAt` + `AuditLogEntry` record |
| **Execute** | `/review/[actionId]` (Proof Receipt) | Copy-paste fix to customer's site (manual, not DEX) | route `/api/actions/[actionId]/evidence` (proof document) + fix instruction |
| **Verify** | `/outcomes` (refetch + confirm) | Manual refetch, confirm change applied, measure outcome | `ScanJob` (new, verification), `PageSnapshot` comparison |
| **Measure** | `/analytics` + `/outcomes` | View outcome impact (GSC, metrics, honest states) | `GuardResult.outcome`, GSC data (when available) |
| **Learn** | `/dashboard/[id]` (feedback bar) | Rate effectiveness, store signal | `FeedbackAnalysis`, `PreferenceCandidateCheck` |
| **Undo** | `/settings` (rollback guidance) + `/outcomes` | Revert decision + guidance; show state in Outcomes | route `/revert` endpoint + `AuditLogEntry` record |

**Key constraint (corrected 2026-10-02):** Execute/Verify/Undo are manual-apply only. No auto-write, no automated rollback. Customer applies fix copy-paste; Dex shows guidance and verification options only.

---

## Navigation Structure

### Desktop (ref: `01-mission-control-desktop.png`)

**Top bar:** Workspace selector, theme toggle, profile menu  
**Left nav (persistent):**
- 🏠 Dashboard
- 📋 Review Queue
- ✏️ Studio
- 📊 Analytics
- ✅ Outcomes
- ⚙️ Settings

**Mobile (ref: `06-mission-control-mobile.png`)**

**Top bar:** Hamburger, workspace, profile  
**Bottom nav:** Dashboard → Review → Studio → Analytics → Outcomes (Settings in profile menu)

---

## State/Data-Source Map

Which Prisma models feed which screens:

| Screen | Primary Models | Secondary |
|---|---|---|
| `/dashboard/[id]` | `Website`, `ScanJob`, `ScanLogLine` (terminal), `Finding` (opportunities bar) | `ClientProfile` (brand rules) |
| `/review` | `Action`, `Finding.evidence`, `GuardResult` | `ScanJob.createdAt` (timing proof) |
| `/studio` | `ContentPiece`, `PreferenceCandidate` + platform-specific adapters | `ClientProfile.brandVoice` |
| `/analytics` | `GuardResult.outcome`, GSC data (via existing connection) | `ScanJob.createdAt` (time range) |
| `/outcomes` | `GuardResult.outcome`, `PageSnapshot` (verification), `AuditLogEntry` (decision trail) | `Finding.evidence` (original) |
| `/settings` | `ClientProfile`, `WorkspaceMember`, `PreferenceEvaluation`, theme prefs | — |

---

## Existing-Route Reuse Map

| Route | Current State | Phase 2A Status |
|---|---|---|
| `/dashboard`, `/dashboard/[id]` | Live; terminal + opportunity board exist | Reuse as-is; add Prioritize UI bar (group finder, sort options) |
| `/review`, `/review/[actionId]` | Live; approval decision flow exists | Reuse as-is; add Proof Receipt + verify-next-steps CTA |
| `/studio` | Live; platform-agnostic export | Reuse as-is; confirm no write-back claims in copy |
| `/settings` | Live; integrations, theme, preferences | Reuse as-is; add rollback guidance section per Undo stage |
| `/analytics` | **Missing** | Needs new implementation; bind to `GuardResult.outcome` + GSC real-data hierarchy |
| `/outcomes` | **Missing** | Needs new implementation; refetch + verification + honest GSC states (awaiting/partial/measured/unavailable) |

---

## Design System & Accessibility

- **Reuse:** warm-black + orange + mint palette (verified in `01-*.png`), Light/Dark/System theme toggle, reduced-motion support, existing mobile-nav behavior
- **Skills policy (per directive):** Confirm installed before citing. **Audit in next session:** product-skills:ux-researcher-designer, design:design-system, design:accessibility-review, ui-ux-pro-max, taste-skill:gpt-tasteskill
- **Evidence:** Reference images at `docs/superpowers/design-references/precision-mission-control/{01,02,03,04,05,06,07,08}-*.png`

---

## Next Steps

1. Human approves this IA/journey map (Phase 2A gate)
2. Phase 2B: `/analytics` screen design + implementation
3. Phase 2C: `/outcomes` screen design + implementation
4. Phase 2D-E: cross-flow verification, mobile polish, release

---

**Word count:** ~850 | **Doc status:** Design audit complete, ready for human approval gate before any code.
