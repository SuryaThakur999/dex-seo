# Dex Week 3: Review UI, Audit Logging, Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-implementation amendment (2026-08-20):** the final whole-branch review found this plan had one real Critical-severity gap, fixed in commit `29d8f6b` on top of the work below — no single task's own review could see it, since it only appears from combining two tasks this plan built independently:
> 1. Task 4's `/review` queue and Task 3's auto-execute toggle interact badly: the queue only ever listed `status: 'pending'` actions, so once the toggle sends an action straight to `status: 'approved'` (or a customer navigates away after manually approving), the copy-paste-ready output ADR 0002 promises has no page linking to it anymore. Fixed post-hoc by adding a "Ready to apply" section to `/review` listing recently-decided (approved/edited) actions.
> 2. Also fixed in the same pass: all four state-changing routes (`approve`/`reject`/`edit`/`auto-execute`) wrote their DB state change and their audit-log entry as two separate, non-atomic calls — a failure on the second call could leave a state change committed with no ADR 0003 consent record. Now wrapped in `db.$transaction([...])`.
> 3. Also fixed: the settings page's own copy incorrectly said auto-execute would "apply" a change automatically — nothing is ever applied automatically per ADR 0002, only the copy-paste output changes. Also: the design system's own `--background`/`--accent` tokens (this plan's own Task 1) were defined but never actually wired into `body` or into any link's className, so every page originally rendered on browser-default white with no visible accent color anywhere.
>
> Left as-is, tracked for later rather than fixed here (per the reviewer's own triage — non-blocking): no automated tests exist for the four routes' authorization logic (block-outcome gate, cross-tenant ownership check) — verified by manual trace during review, worth adding when this surface is touched again; heading structure (`CardTitle` renders a `<div>`, not a real heading level) affects screen-reader navigation; the copy-paste-approve routes redirect with a 307 (preserves POST, browsers may prompt "confirm resubmission" on refresh) rather than the correct 303 — a pre-existing pattern from Week 1's `select-site` route, not new to Week 3; the dashboard page remains deliberately unstyled bare HTML next to three fully designed pages, per this plan's own scope choice to only add links there, not restyle it.

**Goal:** Give a customer a way to see, approve, edit, or reject the AI-drafted meta description changes Week 2's pipeline creates, with every decision and every auto-execute toggle change recorded in a new audit log — and a copy-paste-ready output once a change is finalized, per ADR 0002 (no CMS write-back in Phase 1).

**Architecture:** A new `AuditLogEntry` Prisma model plus a small `audit-log.ts` library function is the single place every customer-facing decision gets recorded. Three new authenticated pages (`/settings`, `/review`, `/review/[actionId]`) and three new route handlers (`approve`/`reject`/`edit`) sit on top of Week 1/2's existing `Customer`/`Action`/`GuardResult` schema — no schema changes to those models. UI is built on shadcn/ui-style primitives (Button, Card, Badge, Separator, Switch, Textarea) hand-written into `src/components/ui/` against a Tailwind v4 + CSS-variable token system, since this is the project's first UI work beyond bare HTML.

**Tech Stack:** Adds Tailwind CSS v4, `class-variance-authority`, `@radix-ui/react-slot`, `@radix-ui/react-switch`, `clsx`, `tailwind-merge`, `@fontsource/fira-sans`, `@fontsource/fira-code` to the existing Next.js 14 / Prisma / Clerk stack.

**Design system (from ui-ux-pro-max + taste-skill research):** Data-Dense Dashboard style (12-col grid mindset, minimal padding, KPI/status cards, sortable lists) — the taste-skill's own scope note explicitly routes dashboards/admin panels to an official component approach rather than freeform landing-page patterns, hence shadcn/ui-style primitives over hand-rolled Tailwind. B2B Service color palette: navy `#0F172A` primary, blue `#0369A1` accent, `#F8FAFC` background, semantic emerald/amber/red badges for GrowthGuard pass/flag/block. Typography: Fira Sans (body) + Fira Code (data/code values) — "dashboard, data, technical, precise" is the intended feel, deliberately not Inter.

## Global Constraints

- No CMS write-back — approving or editing an action never writes to the customer's live site. It only changes `Action.status`/`draftContent` and surfaces a copy-paste block. (ADR 0002)
- Every `Action` decision (approve/edit/reject) and every `Customer.autoExecuteEnabled` toggle change must be recorded in the new audit log — this is the "customer-consent record" ADR 0003 requires. (ADR 0003, spec Section 8)
- A `block`-outcome `GuardResult` can never be approved through the UI — only rejected or edited. Editing is always available regardless of outcome (the customer is authoring their own final version at that point). (spec Section 3)
- `Action.status` values in play this week: `pending` (unchanged from Week 2), `approved`, `edited`, `rejected` — matches the schema's own inline comment (`pending | approved | edited | rejected`) already present in `prisma/schema.prisma` since Week 1.
- No regenerate-a-new-draft flow this week — a `block`ed or rejected action just sits rejected; drafting a fresh one is out of scope. (explicit scope cut, not in original spec bullet list either)
- No emoji, no hand-rolled decorative SVG, one accent color used consistently, WCAG AA contrast on every interactive element. (taste-skill Section 4.2, 4.5, 9)
- Secrets: nothing new introduced this week — no additional env vars.

---

## File Structure

```
postcss.config.mjs                          (NEW)
components.json                             (NEW — shadcn config, for future `npx shadcn add` compatibility)
src/
  app/
    globals.css                             (MODIFY — Tailwind v4 import + design tokens + fonts)
    dashboard/page.tsx                      (MODIFY — add links to /review and /settings)
    settings/page.tsx                       (NEW)
    review/
      page.tsx                              (NEW — pending-actions queue)
      [actionId]/page.tsx                   (NEW — compare view, GrowthGuard result, approve/edit/reject)
    api/
      settings/auto-execute/route.ts        (NEW)
      actions/[actionId]/approve/route.ts   (NEW)
      actions/[actionId]/reject/route.ts    (NEW)
      actions/[actionId]/edit/route.ts      (NEW)
  components/
    ui/
      button.tsx, card.tsx, badge.tsx, separator.tsx, switch.tsx, textarea.tsx  (NEW)
    auto-execute-toggle.tsx                 (NEW — client island wrapping Switch)
    copy-button.tsx                         (NEW — client island for clipboard copy)
  lib/
    utils.ts                                (NEW — shadcn `cn()` helper)
    audit-log.ts                            (NEW — logAuditEvent())
  middleware.ts                             (MODIFY — protect new routes)
prisma/schema.prisma                        (MODIFY — add AuditLogEntry model + Customer relation)
```

One responsibility per file: `audit-log.ts` is the only place that writes `AuditLogEntry` rows. `components/ui/*` are pure presentational primitives, no business logic. The two route-handler groups (`settings/auto-execute`, `actions/[actionId]/*`) each own exactly one state transition.

---

### Task 1: Design System Foundation — Tailwind v4 + UI Primitives + Fonts

**Files:**
- Create: `postcss.config.mjs`
- Create: `components.json`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/separator.tsx`
- Create: `src/components/ui/switch.tsx`
- Create: `src/components/ui/textarea.tsx`
- Modify: `src/app/globals.css`
- Modify: `package.json`

**Interfaces:**
- Produces: `cn(...)` from `@/lib/utils`; `Button`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`, `Badge`, `Separator`, `Switch`, `Textarea` from `@/components/ui/*` — consumed by every later task's pages.

- [ ] **Step 1: Add dependencies to `package.json`**

Add to `dependencies` (alongside the existing entries):
```json
    "@fontsource/fira-code": "^5.1.0",
    "@fontsource/fira-sans": "^5.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-switch": "^1.1.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.2",
```

Add to `devDependencies`:
```json
    "@tailwindcss/postcss": "^4.0.0",
    "postcss": "^8.4.47",
    "tailwindcss": "^4.0.0",
```

Run: `npm install`

- [ ] **Step 2: Write `postcss.config.mjs`**

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

- [ ] **Step 3: Write `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 4: Rewrite `src/app/globals.css`**

```css
@import "tailwindcss";
@import '@fontsource/fira-sans/400.css';
@import '@fontsource/fira-sans/500.css';
@import '@fontsource/fira-sans/600.css';
@import '@fontsource/fira-code/400.css';
@import '@fontsource/fira-code/500.css';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.5rem;
  --background: #F8FAFC;
  --foreground: #0F172A;
  --card: #FFFFFF;
  --card-foreground: #0F172A;
  --popover: #FFFFFF;
  --popover-foreground: #0F172A;
  --primary: #0F172A;
  --primary-foreground: #FFFFFF;
  --secondary: #334155;
  --secondary-foreground: #FFFFFF;
  --muted: #E8ECF1;
  --muted-foreground: #64748B;
  --accent: #0369A1;
  --accent-foreground: #FFFFFF;
  --destructive: #DC2626;
  --destructive-foreground: #FFFFFF;
  --border: #E2E8F0;
  --input: #E2E8F0;
  --ring: #0F172A;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

body {
  font-family: 'Fira Sans', system-ui, sans-serif;
}

code, pre, kbd {
  font-family: 'Fira Code', monospace;
}
```

- [ ] **Step 5: Write `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Write `src/components/ui/button.tsx`**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-background hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        ghost: 'hover:bg-muted',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

- [ ] **Step 7: Write `src/components/ui/card.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
```

- [ ] **Step 8: Write `src/components/ui/badge.tsx`**

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-transparent bg-emerald-100 text-emerald-800',
      secondary: 'border-transparent bg-amber-100 text-amber-800',
      destructive: 'border-transparent bg-red-100 text-red-800',
      outline: 'border-border text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 9: Write `src/components/ui/separator.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Separator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }
>(({ className, orientation = 'horizontal', ...props }, ref) => (
  <div
    ref={ref}
    className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    {...props}
  />
));
Separator.displayName = 'Separator';

export { Separator };
```

- [ ] **Step 10: Write `src/components/ui/switch.tsx`**

```tsx
'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted',
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export { Switch };
```

- [ ] **Step 11: Write `src/components/ui/textarea.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
```

- [ ] **Step 12: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 13: Commit**

```bash
git add postcss.config.mjs components.json src/app/globals.css src/lib/utils.ts src/components/ui package.json package-lock.json
git commit -m "feat: add Tailwind v4 + shadcn-style UI primitives + Fira Sans/Code fonts"
```

---

### Task 2: Audit Log — Prisma Model + Library

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/audit-log.ts`
- Test: `src/lib/audit-log.test.ts`

**Interfaces:**
- Produces: `type AuditEventType = 'action_decided' | 'auto_execute_toggled'`, `logAuditEvent(customerId: string, eventType: AuditEventType, detail: Record<string, unknown>, actionId?: string): Promise<void>` — used by Task 3 (toggle route) and Task 5 (approve/reject/edit routes).

- [ ] **Step 1: Add `AuditLogEntry` to `prisma/schema.prisma`**

Add this model at the end of the file:

```prisma
model AuditLogEntry {
  id         String   @id @default(cuid())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  eventType  String
  actionId   String?
  detail     Json
  createdAt  DateTime @default(now())
}
```

Add the back-relation to the existing `Customer` model — insert this line inside `model Customer { ... }`, alongside the existing `actions Action[]` line:

```prisma
  auditLogEntries AuditLogEntry[]
```

- [ ] **Step 2: Generate and apply the migration**

Set `DATABASE_URL` in `.env.local` to a real Neon Postgres connection string (same one Week 1/2 used).

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

Run: `npx prisma migrate dev --name add_audit_log`
Expected: migration created and applied, `AuditLogEntry` table exists.

- [ ] **Step 3: Write the failing test**

```ts
// src/lib/audit-log.test.ts
import { describe, it, expect, vi } from 'vitest';
import { logAuditEvent } from './audit-log';
import { db } from './db';

vi.mock('./db', () => ({
  db: {
    auditLogEntry: {
      create: vi.fn(),
    },
  },
}));

describe('logAuditEvent', () => {
  it('creates an audit log entry with the given customer, event type, detail, and optional actionId', async () => {
    await logAuditEvent('cust_1', 'auto_execute_toggled', { enabled: true }, undefined);

    expect(db.auditLogEntry.create).toHaveBeenCalledWith({
      data: { customerId: 'cust_1', eventType: 'auto_execute_toggled', actionId: undefined, detail: { enabled: true } },
    });
  });

  it('includes actionId when provided', async () => {
    await logAuditEvent('cust_1', 'action_decided', { decision: 'approved' }, 'action_1');

    expect(db.auditLogEntry.create).toHaveBeenCalledWith({
      data: { customerId: 'cust_1', eventType: 'action_decided', actionId: 'action_1', detail: { decision: 'approved' } },
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/audit-log.test.ts`
Expected: FAIL — `Cannot find module './audit-log'`

- [ ] **Step 5: Write `src/lib/audit-log.ts`**

```ts
import { db } from './db';

export type AuditEventType = 'action_decided' | 'auto_execute_toggled';

export async function logAuditEvent(
  customerId: string,
  eventType: AuditEventType,
  detail: Record<string, unknown>,
  actionId?: string
): Promise<void> {
  await db.auditLogEntry.create({
    data: { customerId, eventType, actionId, detail },
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/audit-log.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/audit-log.ts src/lib/audit-log.test.ts
git commit -m "feat: add AuditLogEntry model and logAuditEvent() library"
```

---

### Task 3: Account Settings — Auto-Execute Toggle

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/components/auto-execute-toggle.tsx`
- Create: `src/app/api/settings/auto-execute/route.ts`

**Interfaces:**
- Consumes: `logAuditEvent` (Task 2), `Switch`/`Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` (Task 1), `db`, `ensureCustomer`-equivalent lookup pattern from `customer.ts`.
- Produces: `POST /api/settings/auto-execute` — used only by this task's own client component.

- [ ] **Step 1: Write `src/components/auto-execute-toggle.tsx`**

```tsx
'use client';

import { useTransition } from 'react';
import { Switch } from '@/components/ui/switch';

export function AutoExecuteToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    startTransition(async () => {
      await fetch('/api/settings/auto-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: checked }),
      });
      window.location.reload();
    });
  }

  return (
    <Switch checked={initialEnabled} onCheckedChange={handleChange} disabled={isPending} aria-label="Auto-execute toggle" />
  );
}
```

- [ ] **Step 2: Write `src/app/api/settings/auto-execute/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit-log';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const enabled = Boolean(body.enabled);

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  await db.customer.update({ where: { id: customer.id }, data: { autoExecuteEnabled: enabled } });
  await logAuditEvent(customer.id, 'auto_execute_toggled', { enabled, at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Write `src/app/settings/page.tsx`**

```tsx
import { auth } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AutoExecuteToggle } from '@/components/auto-execute-toggle';

export default async function SettingsPage() {
  const { userId } = auth();
  if (!userId) return null;

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Account settings</h1>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Auto-execute</CardTitle>
          <CardDescription>
            When a drafted change passes every GrowthGuard check, skip the manual approval click and apply it
            automatically. Flagged or blocked changes always require your review, no matter this setting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutoExecuteToggle initialEnabled={customer.autoExecuteEnabled} />
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/page.tsx src/components/auto-execute-toggle.tsx src/app/api/settings/auto-execute/route.ts
git commit -m "feat: add account settings page with audited auto-execute toggle"
```

---

### Task 4: Review Queue — Pending Actions List

**Files:**
- Create: `src/app/review/page.tsx`

**Interfaces:**
- Consumes: `db`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Badge` (Task 1).
- Produces: `/review` page — links to Task 5's `/review/[actionId]` detail page.

- [ ] **Step 1: Write `src/app/review/page.tsx`**

```tsx
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const OUTCOME_LABEL: Record<string, string> = { pass: 'Pass', flag: 'Needs review', block: 'Blocked' };
const OUTCOME_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  pass: 'default',
  flag: 'secondary',
  block: 'destructive',
};

export default async function ReviewQueuePage() {
  const { userId } = auth();
  if (!userId) return null;

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return null;

  const pendingActions = await db.action.findMany({
    where: { customerId: customer.id, status: 'pending' },
    include: { guardResult: true },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Review queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {pendingActions.length} change{pendingActions.length === 1 ? '' : 's'} waiting for your review.
      </p>

      {pendingActions.length === 0 && (
        <Card className="mt-6">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing to review right now. Scan your site from the dashboard to find more opportunities.
          </CardContent>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {pendingActions.map((action) => (
          <Link key={action.id} href={`/review/${action.id}`}>
            <Card className="transition-colors hover:border-primary/40">
              <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base font-medium">{action.pageUrl}</CardTitle>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{action.draftContent}</p>
                </div>
                {action.guardResult && (
                  <Badge variant={OUTCOME_VARIANT[action.guardResult.outcome] ?? 'secondary'}>
                    {OUTCOME_LABEL[action.guardResult.outcome] ?? action.guardResult.outcome}
                  </Badge>
                )}
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/review/page.tsx
git commit -m "feat: add review queue page listing pending Actions"
```

---

### Task 5: Action Detail — Compare View, Approve/Edit/Reject, Copy-Paste Output

**Files:**
- Create: `src/app/review/[actionId]/page.tsx`
- Create: `src/components/copy-button.tsx`
- Create: `src/app/api/actions/[actionId]/approve/route.ts`
- Create: `src/app/api/actions/[actionId]/reject/route.ts`
- Create: `src/app/api/actions/[actionId]/edit/route.ts`

**Interfaces:**
- Consumes: `logAuditEvent` (Task 2), `db`, `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Badge`, `Button`, `Textarea` (Task 1).
- Produces: the Week 3 capstone — a customer can fully review and finalize a drafted change.

- [ ] **Step 1: Write `src/components/copy-button.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
```

- [ ] **Step 2: Write `src/app/api/actions/[actionId]/approve/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit-log';

export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId }, include: { guardResult: true } });
  if (!action || action.customerId !== customer.id || action.status !== 'pending') {
    return NextResponse.json({ error: 'Action not found or already decided' }, { status: 404 });
  }
  if (action.guardResult?.outcome === 'block') {
    return NextResponse.json({ error: 'Blocked drafts cannot be approved' }, { status: 400 });
  }

  await db.action.update({ where: { id: action.id }, data: { status: 'approved', decidedAt: new Date() } });
  await logAuditEvent(customer.id, 'action_decided', { decision: 'approved', pageUrl: action.pageUrl }, action.id);

  return NextResponse.redirect(new URL(`/review/${action.id}`, req.url));
}
```

- [ ] **Step 3: Write `src/app/api/actions/[actionId]/reject/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit-log';

export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId } });
  if (!action || action.customerId !== customer.id || action.status !== 'pending') {
    return NextResponse.json({ error: 'Action not found or already decided' }, { status: 404 });
  }

  await db.action.update({ where: { id: action.id }, data: { status: 'rejected', decidedAt: new Date() } });
  await logAuditEvent(customer.id, 'action_decided', { decision: 'rejected', pageUrl: action.pageUrl }, action.id);

  return NextResponse.redirect(new URL(`/review/${action.id}`, req.url));
}
```

- [ ] **Step 4: Write `src/app/api/actions/[actionId]/edit/route.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logAuditEvent } from '@/lib/audit-log';

export async function POST(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({ where: { id: params.actionId } });
  if (!action || action.customerId !== customer.id || action.status !== 'pending') {
    return NextResponse.json({ error: 'Action not found or already decided' }, { status: 404 });
  }

  const form = await req.formData();
  const draftContent = form.get('draftContent');
  if (typeof draftContent !== 'string' || !draftContent.trim()) {
    return NextResponse.json({ error: 'Edited content cannot be empty' }, { status: 400 });
  }

  await db.action.update({
    where: { id: action.id },
    data: { draftContent: draftContent.trim(), status: 'edited', decidedAt: new Date() },
  });
  await logAuditEvent(customer.id, 'action_decided', { decision: 'edited', pageUrl: action.pageUrl }, action.id);

  return NextResponse.redirect(new URL(`/review/${action.id}`, req.url));
}
```

- [ ] **Step 5: Write `src/app/review/[actionId]/page.tsx`**

```tsx
import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/copy-button';

const OUTCOME_LABEL: Record<string, string> = { pass: 'Pass', flag: 'Needs review', block: 'Blocked' };
const OUTCOME_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  pass: 'default',
  flag: 'secondary',
  block: 'destructive',
};

export default async function ActionDetailPage({ params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return null;

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return null;

  const action = await db.action.findUnique({
    where: { id: params.actionId },
    include: { guardResult: true },
  });

  if (!action || action.customerId !== customer.id) notFound();

  const checksRun = (action.guardResult?.checksRun ?? []) as { check: string; result: string; detail: string }[];
  const isFinal = action.status === 'approved' || action.status === 'edited';
  const canApprove = action.status === 'pending' && action.guardResult?.outcome !== 'block';

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-sm text-muted-foreground">{action.pageUrl}</p>
      <h1 className="mt-1 text-2xl font-semibold text-foreground">Meta description change</h1>

      <p className="mt-4 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
        This description was drafted by AI and checked against Dex&apos;s safety rules before reaching you.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Current</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground">
            {action.currentValue || 'No meta description found on the live page.'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Drafted by Dex</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-foreground">{action.draftContent}</CardContent>
        </Card>
      </div>

      {action.guardResult && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">GrowthGuard result</CardTitle>
            <Badge variant={OUTCOME_VARIANT[action.guardResult.outcome] ?? 'secondary'}>
              {OUTCOME_LABEL[action.guardResult.outcome] ?? action.guardResult.outcome}
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{action.guardResult.reasoning}</p>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {checksRun.map((check) => (
                <li key={check.check} className="flex items-start gap-2">
                  <span className={check.result === 'pass' ? 'text-emerald-600' : 'text-amber-600'}>
                    {check.result === 'pass' ? '✓' : '!'}
                  </span>
                  <span className="text-foreground">{check.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {action.status === 'pending' && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {canApprove && (
            <form action={`/api/actions/${action.id}/approve`} method="post">
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Approve
              </button>
            </form>
          )}
          <form action={`/api/actions/${action.id}/reject`} method="post">
            <button
              type="submit"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Reject
            </button>
          </form>
          <details className="ml-auto w-full sm:w-auto">
            <summary className="cursor-pointer text-sm font-medium text-primary">Edit before using</summary>
            <form action={`/api/actions/${action.id}/edit`} method="post" className="mt-3 flex flex-col gap-2">
              <textarea
                name="draftContent"
                defaultValue={action.draftContent}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <button
                type="submit"
                className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Save and use this version
              </button>
            </form>
          </details>
        </div>
      )}

      {isFinal && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ready to apply</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Copy this into your site&apos;s meta description field. Dex doesn&apos;t write directly to your CMS in
              this version.
            </p>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <code className="flex-1 text-sm text-foreground">{action.draftContent}</code>
              <CopyButton text={action.draftContent} />
            </div>
          </CardContent>
        </Card>
      )}

      {action.status === 'rejected' && (
        <p className="mt-6 text-sm text-muted-foreground">You rejected this draft. No changes were applied.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: `✓ Compiled successfully`, new routes registered (`/review`, `/review/[actionId]`, `/settings`, `/api/actions/[actionId]/approve`, `.../reject`, `.../edit`, `/api/settings/auto-execute`).

- [ ] **Step 7: Commit**

```bash
git add src/app/review src/components/copy-button.tsx src/app/api/actions
git commit -m "feat: add action detail page with approve/edit/reject and copy-paste output"
```

---

### Task 6: Wire Middleware Protection + Dashboard Links

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: nothing new — this task only extends the existing route matcher and adds navigation links.
- Produces: the final Week 3 deliverable — `/review`, `/review/[actionId]`, `/settings`, and their API routes are all authenticated, and a signed-in customer can navigate from `/dashboard` into the review flow.

- [ ] **Step 1: Modify `src/middleware.ts`**

Update the `createRouteMatcher` call to add the four new protected prefixes:

```ts
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/review(.*)',
  '/settings(.*)',
  '/api/gsc(.*)',
  '/api/scan(.*)',
  '/api/actions(.*)',
  '/api/settings(.*)',
]);
```

Leave the rest of the file (the `clerkMiddleware` call and `config.matcher`) exactly as-is.

- [ ] **Step 2: Modify `src/app/dashboard/page.tsx`**

Add two links near the top of the returned JSX, right after the `<h1>Dashboard</h1>` line:

```tsx
<div className="mt-2 flex gap-4 text-sm">
  <a href="/review" className="font-medium text-primary underline-offset-4 hover:underline">
    Review queue
  </a>
  <a href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
    Settings
  </a>
</div>
```

Insert it directly after the `<h1>Dashboard</h1>` line and before the existing `<p>Customer ID: ...` line — do not change any other logic in this file.

- [ ] **Step 3: Type-check, build, and run the full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all existing tests still passing, no regressions (this task adds no new tests — pure route-protection and navigation wiring).

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts src/app/dashboard/page.tsx
git commit -m "feat: protect Week 3 routes in middleware, link dashboard to review queue and settings"
```
