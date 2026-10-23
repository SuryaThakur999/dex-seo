# GrowthGuard Review Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/review` and `/review/[actionId]` into the same dark coral/amber `.dex-app` shell and icon-rail navigation the dashboard already has, and make the real GrowthGuard checklist data (`checksRun`, `reasoning`) visually legible with icons and labels instead of a raw `✓`/`!` glyph and a bare detail sentence.

**Architecture:** Extract the icon-rail sidebar `dashboard/layout.tsx` already inlines into a shared client component, reuse it in a new `review/layout.tsx`, add a `CHECK_ICON`/`CHECK_LABEL` lookup next to the existing `OUTCOME_LABEL`/`OUTCOME_VARIANT` maps in `guard-outcome-ui.ts`, and consume both in `review/[actionId]/page.tsx`. No backend changes — `growth-guard.ts`'s five real checks are rendered, not reinterpreted.

**Tech Stack:** Next.js App Router (server + one new client component), Tailwind CSS via the existing `.dex-app` token scope, Phosphor icons, Vitest.

## Global Constraints

- No new npm dependency, no new CSS tokens — this plan uses only colors already defined in `src/app/globals.css`'s `.dex-app` block: `--dex-app-success`, `--dex-app-warning`/`-bg`, `--dex-app-danger`/`-bg`.
- `/settings` is explicitly untouched by this plan — noted in the design as a follow-up candidate, not fixed now.
- No change to `growth-guard.ts`, its five check names, or its outcome logic — this plan is a rendering pass over data that already exists.
- Client-component icon imports use `@phosphor-icons/react` (no `/dist/ssr` suffix); server-component icon imports use `@phosphor-icons/react/dist/ssr` — matching the convention already established in `scan-health-card.tsx` (client) vs `stat-card.tsx` (server) from the prior dashboard rebuild.

---

### Task 1: Extract the shared icon rail, wire it into `dashboard/layout.tsx`

**Files:**
- Create: `src/components/app-shell/icon-rail.tsx`
- Modify: `src/app/dashboard/layout.tsx`

**Interfaces:**
- Produces: `IconRail()` — a client component, no props, renders the logo mark and the three-item nav (`Dashboard`, `Review queue`, `Settings`), with the current route's item visually marked active.

- [ ] **Step 1: Create the shared component**

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SquaresFour, ListChecks, Gear } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/review', label: 'Review queue', icon: ListChecks },
  { href: '/settings', label: 'Settings', icon: Gear },
];

export function IconRail() {
  const pathname = usePathname();

  return (
    <aside className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-border py-6">
      <div className="mb-6 flex h-8 w-8 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
        D
      </div>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground',
              isActive ? 'bg-muted text-accent' : 'text-muted-foreground'
            )}
            title={item.label}
          >
            <item.icon size={20} weight="regular" aria-hidden="true" />
            <span className="sr-only">{item.label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
```

- [ ] **Step 2: Replace `dashboard/layout.tsx`'s inlined rail with the shared component**

Replace the full contents of `src/app/dashboard/layout.tsx`:

```typescript
import { IconRail } from '@/components/app-shell/icon-rail';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dex-app dark flex min-h-screen bg-background text-foreground">
      <IconRail />
      <div className="flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Run the test suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — this task adds no new logic branches that need a dedicated unit test (a 3-item nav array with route matching has no existing component-test convention in this codebase; `dashboard/layout.tsx` itself has none today either). Visual confirmation of the active-state highlight happens in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell/icon-rail.tsx src/app/dashboard/layout.tsx
git commit -m "$(cat <<'EOF'
feat: extract shared IconRail component with active-state highlighting

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 2: New `review/layout.tsx` — join the dark shell

**Files:**
- Create: `src/app/review/layout.tsx`
- Test: none (see Step 2)

**Interfaces:**
- Consumes: `IconRail` from Task 1 (`@/components/app-shell/icon-rail`)

- [ ] **Step 1: Create the layout**

```typescript
import { IconRail } from '@/components/app-shell/icon-rail';

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dex-app dark flex min-h-screen bg-background text-foreground">
      <IconRail />
      <div className="flex-1">{children}</div>
    </div>
  );
}
```

This is intentionally identical in structure to `dashboard/layout.tsx` — Next.js App Router layouts don't nest across sibling top-level route directories (`/dashboard` and `/review` are siblings under `src/app/`), so this 9-line wrapper is the correct minimal duplication rather than inventing a shared `AppShellLayout` abstraction for two call sites this small.

- [ ] **Step 2: Confirm `review/page.tsx` needs no content changes**

Read `src/app/review/page.tsx`. Every color-bearing className in this file is already a semantic Tailwind token that resolves through the `.dex-app` CSS custom properties this new layout now provides — `text-foreground`, `text-muted-foreground`, the `Card`/`CardHeader`/`CardTitle`/`CardContent` components (already token-based, confirmed by their definitions in `src/components/ui/card.tsx`), `Badge` (token-based, already used correctly in the dark-themed dashboard today), and `hover:border-primary/40` / `hover:border-accent/40` (theme tokens, not literal colors). There is no hardcoded light-only color anywhere in this file (no `text-gray-*`, no literal hex, no `-700`/`-900` shade utilities). Confirm this with:

```bash
grep -nE "text-(gray|slate|zinc|neutral)-|#[0-9a-fA-F]{3,6}|-(700|800|900)\b" src/app/review/page.tsx
```

Expected: no output. If this grep finds something, stop and report it — that would mean the file has drifted from what this plan assumes, and needs a real fix before proceeding, not a skipped step.

- [ ] **Step 3: Run the test suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/review/layout.tsx
git commit -m "$(cat <<'EOF'
feat: bring /review into the dark app shell via a new layout

review/page.tsx needed no content changes — its classNames were
already semantic tokens, confirmed by grep for hardcoded colors.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 3: `CHECK_ICON` / `CHECK_LABEL` maps, with a completeness test

**Files:**
- Modify: `src/lib/guard-outcome-ui.ts`
- Test: `src/lib/guard-outcome-ui.test.ts` (new)

**Interfaces:**
- Produces: `CHECK_ICON: Record<string, PhosphorIcon>`, `CHECK_LABEL: Record<string, string>`, keyed by the five real check names from `growth-guard.ts` (`'ai-content-disclosure'`, `'no-unverifiable-claims'`, `'no-contradiction'`, `'length-format'`, `'duplicate-risk'`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/guard-outcome-ui.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CHECK_ICON, CHECK_LABEL } from './guard-outcome-ui';

// This list is not imported from growth-guard.ts because that file doesn't export
// its check names as a collection (each is a string literal inside its own check
// function). Keep this list in sync by hand — if a check is renamed or a sixth
// check is added there without a matching update here, this test is what catches
// the missing icon/label instead of the review page silently rendering `undefined`.
const GROWTH_GUARD_CHECK_NAMES = [
  'ai-content-disclosure',
  'no-unverifiable-claims',
  'no-contradiction',
  'length-format',
  'duplicate-risk',
];

describe('CHECK_ICON and CHECK_LABEL', () => {
  it('has an icon and a label for every real GrowthGuard check name', () => {
    for (const name of GROWTH_GUARD_CHECK_NAMES) {
      expect(CHECK_ICON[name]).toBeDefined();
      expect(CHECK_LABEL[name]).toBeDefined();
    }
  });

  it('has exactly the same keys in both maps', () => {
    expect(Object.keys(CHECK_ICON).sort()).toEqual(Object.keys(CHECK_LABEL).sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/guard-outcome-ui.test.ts`
Expected: FAIL — `CHECK_ICON is not exported` (or `undefined`)

- [ ] **Step 3: Implement**

Add to `src/lib/guard-outcome-ui.ts` (the existing `OUTCOME_LABEL`/`OUTCOME_VARIANT` exports stay exactly as they are):

```typescript
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Fingerprint, Scales, Prohibit, Ruler, Copy } from '@phosphor-icons/react/dist/ssr';

export const CHECK_ICON: Record<string, PhosphorIcon> = {
  'ai-content-disclosure': Fingerprint,
  'no-unverifiable-claims': Scales,
  'no-contradiction': Prohibit,
  'length-format': Ruler,
  'duplicate-risk': Copy,
};

export const CHECK_LABEL: Record<string, string> = {
  'ai-content-disclosure': 'AI disclosure',
  'no-unverifiable-claims': 'Verifiable claims',
  'no-contradiction': 'No contradiction',
  'length-format': 'Length',
  'duplicate-risk': 'Not a duplicate',
};
```

`/dist/ssr` is used here (not the plain client import) because the only consumer, `review/[actionId]/page.tsx`, is a server component (no `'use client'` directive in that file).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/guard-outcome-ui.test.ts`
Expected: PASS, both tests

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/guard-outcome-ui.ts src/lib/guard-outcome-ui.test.ts
git commit -m "$(cat <<'EOF'
feat: add CHECK_ICON/CHECK_LABEL maps for the five GrowthGuard checks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 4: Restyle `review/[actionId]/page.tsx` and add the check-icon row

**Files:**
- Modify: `src/app/review/[actionId]/page.tsx`

**Interfaces:**
- Consumes: `CHECK_ICON`, `CHECK_LABEL` from Task 3 (`@/lib/guard-outcome-ui`)

- [ ] **Step 1: Update the import block**

Replace the current import lines:

```typescript
import { OUTCOME_LABEL, OUTCOME_VARIANT } from '@/lib/guard-outcome-ui';
import type { GuardCheckResult } from '@/lib/growth-guard';
```

with:

```typescript
import { OUTCOME_LABEL, OUTCOME_VARIANT, CHECK_ICON, CHECK_LABEL } from '@/lib/guard-outcome-ui';
import type { GuardCheckResult } from '@/lib/growth-guard';
import { cn } from '@/lib/utils';
```

- [ ] **Step 2: Replace the GrowthGuard result card's content**

Replace the existing `<CardContent>...</CardContent>` block inside the `{action.guardResult && (...)}` card (currently the block containing the `reasoning` paragraph and the `checksRun.map` list) with:

```typescript
          <CardContent>
            {action.status === 'edited' && (
              <p className="mb-3 text-sm text-muted-foreground">
                This reflects GrowthGuard&apos;s check of the original AI draft. Your edited version below was not re-checked.
              </p>
            )}
            <p className="text-sm text-muted-foreground">{action.guardResult.reasoning}</p>

            <div className="mt-4 flex gap-2">
              {checksRun.map((check) => {
                const Icon = CHECK_ICON[check.check];
                if (!Icon) return null;
                return (
                  <span
                    key={check.check}
                    title={`${CHECK_LABEL[check.check] ?? check.check}: ${check.result === 'pass' ? 'passed' : 'failed'}`}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md border',
                      check.result === 'pass'
                        ? 'border-border text-muted-foreground'
                        : action.guardResult?.outcome === 'block'
                          ? 'border-[var(--dex-app-danger)] text-[var(--dex-app-danger)] bg-[var(--dex-app-danger-bg)]'
                          : 'border-[var(--dex-app-warning)] text-[var(--dex-app-warning)] bg-[var(--dex-app-warning-bg)]'
                    )}
                  >
                    <Icon size={16} weight="regular" aria-hidden="true" />
                  </span>
                );
              })}
            </div>

            <ul className="mt-4 flex flex-col gap-1.5 text-sm">
              {checksRun.map((check) => (
                <li key={check.check} className="flex items-start gap-2">
                  <span
                    className={
                      check.result === 'pass'
                        ? 'text-[var(--dex-app-success)]'
                        : action.guardResult?.outcome === 'block'
                          ? 'text-[var(--dex-app-danger)]'
                          : 'text-[var(--dex-app-warning)]'
                    }
                  >
                    {check.result === 'pass' ? '✓' : '!'}
                  </span>
                  <span className="text-foreground">
                    <span className="font-medium">{CHECK_LABEL[check.check] ?? check.check}:</span>{' '}
                    {check.detail}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
```

This replaces the previous hardcoded `text-emerald-700` / `text-red-700` / `text-amber-700` (light-mode-tuned shades with no dark-mode counterpart) with the existing `--dex-app-success` / `--dex-app-danger` / `--dex-app-warning` CSS custom properties already defined in `globals.css`'s `.dex-app` block and already used elsewhere (`GuardBreakdown`, `StatCard`'s delta pill).

- [ ] **Step 3: Run the test suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/app/review/[actionId]/page.tsx"
git commit -m "$(cat <<'EOF'
feat: add GrowthGuard check-icon row, fix hardcoded light-mode colors

Replaces text-emerald-700/text-red-700/text-amber-700 (no dark-mode
counterpart) with the existing --dex-app-success/-warning/-danger
tokens, and labels each check by name instead of showing only its
detail sentence.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0146brKzmUDVPHH2R4q5BWPC
EOF
)"
```

---

### Task 5: Visual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Verify the empty `/review` state (no seed data required)**

```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto "http://localhost:3000/review"
```

This redirects to sign-in if not authenticated in this browser session — sign in as the founder's real dev account (already used earlier this session to reach `/dashboard`), then re-navigate to `/review`. Screenshot it: confirm the dark shell, the icon rail with "Review queue" highlighted active, and either the empty-state card or a real pending-actions list if any exist from prior scans.

- [ ] **Step 3: Seed one realistic action for `/review/[actionId]` visual QA**

If no real `Action` with a `GuardResult` exists yet in the local dev database, create one temporary row for visual verification only — this is dev-database-only, not a migration, not a committed file:

```bash
npx tsx -e "
import { db } from './src/lib/db';

async function main() {
  const customer = await db.customer.findFirst();
  if (!customer) { console.error('No customer in dev DB — sign in once first.'); process.exit(1); }

  const action = await db.action.create({
    data: {
      customerId: customer.id,
      pageUrl: 'https://example.com/pricing',
      actionType: 'meta_description',
      currentValue: 'Pricing plans for our product.',
      draftContent: 'Compare pricing plans and find the right fit for your team, starting at \$19/month.',
      aiDisclosure: true,
      status: 'pending',
      guardResult: {
        create: {
          outcome: 'flag',
          checksRun: [
            { check: 'ai-content-disclosure', result: 'pass', detail: 'Disclosure flag attached.' },
            { check: 'no-unverifiable-claims', result: 'pass', detail: 'No unverifiable numeric or superlative claims found.' },
            { check: 'no-contradiction', result: 'pass', detail: 'Draft does not contradict the source page content.' },
            { check: 'length-format', result: 'fail', detail: 'Draft is 178 characters, over the 155-character guidance.' },
            { check: 'duplicate-risk', result: 'pass', detail: 'No near-duplicate found among recent drafts for this customer.' },
          ],
          reasoning: 'Draft is 178 characters, over the 155-character guidance.',
        },
      },
    },
  });
  console.log('Seeded action:', action.id, '— visit /review/' + action.id);
}

main();
"
```

- [ ] **Step 4: Verify `/review/[actionId]`**

```bash
$B goto "http://localhost:3000/review/<the-id-printed-above>"
$B screenshot /tmp/dex-review-detail.png
```

Read the screenshot. Confirm: dark shell present, icon rail shows "Review queue" active, the 5-icon check row renders with the `length-format` check (Ruler icon) tinted amber (this seed uses `flag`, not `block`) and the other four muted, the detail list below shows each check's label before its sentence, and the "Needs review" outcome badge renders correctly on dark.

- [ ] **Step 5: Check console and network for errors**

```bash
$B console --errors
$B network
```
Expected: no errors, no failed requests

- [ ] **Step 6: Clean up the seed row and stop the dev server**

```bash
npx tsx -e "
import { db } from './src/lib/db';
async function main() {
  const action = await db.action.findFirst({ where: { pageUrl: 'https://example.com/pricing' } });
  if (action) {
    await db.guardResult.deleteMany({ where: { actionId: action.id } });
    await db.action.delete({ where: { id: action.id } });
    console.log('Cleaned up seed action', action.id);
  }
}
main();
"
```

Stop the dev server.
