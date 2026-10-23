# Mission Control slice harness

Formalizes the loop already run 8 times this session (shell/nav, Opportunity Board, terminal, Crawl Runner, Crawl Runner risk closure, Settings, Review) so the remaining screens (Content Studio, Analytics, Outcomes) and any future Dex UI slice follow the same proven contract instead of re-deriving it. Promoted from repeated practice, not written speculatively — matches `ecc:dynamic-workflow-mode`'s "repeated task with a stable input/output contract" criterion for extraction.

## Objective

- **Ship:** one screen/feature from the design reference pack (`docs/superpowers/design-reference/2026-09-14-precision-mission-control/`), implemented against real data, tested, deployed, and live-verified.
- **Do not ship:** multiple screens in one pass, speculative refactors unrelated to the current screen, or any change to a screen already shipped without new failing evidence against it.

## Inputs

- One reference image + its README note from the design pack.
- The DEX CONTINUATION MASTER DIRECTIVE (`docs/superpowers/specs/2026-09-14-dex-continuation-master-directive-mission-control.md`) for the phase's specific requirements.
- Current repo state: existing components/routes touching this screen, read before writing anything (this session's repeated real finding: existing infra was usually more complete than assumed — e.g. `ReviewQueuePanel`'s master-detail already existed, `ClientProfile.markets/languages` already existed unexposed).
- Prisma schema, inspected before any migration.

## Loop

1. **Discover current state.** Read every existing file that touches this screen before writing new code. Grep for prior art (a "duplicate implementation" is a real risk this session hit twice: Content Studio's own drafts list vs. any dashboard equivalent, and Review's dashboard-tab vs. standalone-page split).
2. **Design decision, stated inline** (not a separate meeting): what's real data vs. what the reference shows that has no backing data yet — state the gap and defer it explicitly rather than fabricate. Schema changes get inspected against existing fields first; additive migrations only, developed against an isolated Neon dev branch, applied to prod before dependent code ships.
3. **Implement the smallest coherent slice.** Reuse existing components over rebuilding (this session's Review and Language/market work both reused rather than duplicated). Pure logic extracted into tested lib functions where real branching exists (grouping, status derivation, friendly-text mapping).
4. **Eval gate, always all three, always fresh:**
   - `npx tsc --noEmit` — must be silent.
   - `npx vitest run` — full suite, not just new files; note the before/after count.
   - `npx next build` — must be clean; check the new route actually appears in the route table.
5. **Deploy:** `vercel deploy --prod --yes`, then `vercel inspect https://dex-ai-plum.vercel.app` to confirm the alias serves the new deployment id. Never deploy schema-dependent code before its migration has been applied.
6. **Browser-verify with real data**, not assumed from the code: `browse connect` (real Chrome profile, not the headless daemon, which starts an unauthenticated profile) against production, or the `previewMode`/`dashboard-preview` safe fixture for anything that would otherwise require manipulating a real scan/game/timer. Screenshot the real state, read it back, confirm it matches what the code should produce.
7. **Record and commit the handoff** in `docs/superpowers/plans/2026-09-10-dex-master-brief-progress.md` — what shipped, what was deferred and why, the deployment id, the live-verification evidence path. This doc is the control pane: any session can resume from its own "For a fresh session picking this up" section without re-deriving state.
8. **Stop the slice here.** Move to the next screen only after this one's eval gate and live verification both pass — never bundle two screens into one commit.

## Eval

- **Command:** `npx tsc --noEmit && npx vitest run && npx next build`
- **Expected pass signal:** zero tsc errors, 100% of vitest suite green (report the exact N/N, not "passed"), build completes with the new/changed route present in the printed route table.
- **Failure owner:** whoever's implementing the slice — a red gate blocks deploy, full stop, no exceptions carved out for "just this once."

## Handoff

- **Status:** tracked per-slice in the progress doc's dated section headers (e.g. "## Review workspace — one shared implementation, live-verified (`cd39ce3`)").
- **Evidence:** screenshots under `docs/superpowers/evidence/2026-09-14-<slice-name>/`, one directory per slice.
- **Next action:** the progress doc's trailing "**Next unit:**" line after every slice — always names the next screen in the user's specified order (Content Studio → Analytics → Outcomes → mobile pass → full regression, as of this writing).

## Next reusable extraction candidate

If this exact loop is needed on a different repo (not just the remaining Dex screens), promote it from this spec doc into a real `.claude/skills/<name>/SKILL.md` with the eval command and directory conventions parameterized. Not done yet — every use so far has been this one repo, one directive, so a project-local spec is the right altitude; a portable skill would be premature generalization from a single project's evidence.
