# Dex Precision Mission Control — Visual Reference Pack

These files are visual direction, not production screenshots. Implement them against the existing Dex repository and real data.

## Screen map

1. `01-mission-control-desktop.png` — primary dashboard with one URL command, live audit, top opportunities, and optional game invitation.
2. `02-analytics.png` — audit coverage and honest measured-data hierarchy.
3. `03-review-master-detail.png` — review queue and draft detail. The action is **Approve draft**, never auto-publish.
4. `04-content-studio.png` — platform-specific creation and preview.
5. `05-outcomes.png` — outcomes and evidence; show unavailable GSC data as unavailable, never zero.
6. `06-mission-control-mobile.png` — mobile dashboard and bottom navigation.
7. `07-crawl-runner-active.png` — optional original game running independently from the audit.
8. `08-settings.png` — workspace, integrations, theme, preferences, and enterprise game controls.

## Mandatory corrections

- Any mockup text rendered as `G44` means **GA4**.
- Review approval means approval of a draft for the existing workflow. Do not claim CMS publication unless a real publishing integration exists.
- Mockup numbers are illustrative. Bind the interface only to real backend data.
- `ProofLayer passed` must identify what passed; never place a generic PASS beside an unresolved issue.
- Preserve the warm-black, orange, mint, light/dark/system theme system and URL-only audit behavior.
- Okara is an interaction reference only. Do not copy proprietary code, assets, copy, or complete screen compositions.

## Implementation order

Shared shell and tokens → Mission Control → live terminal and completion receipt → Crawl Runner → Opportunity Board → Review → Content Studio → Analytics → Outcomes → Settings → mobile/responsive verification.
