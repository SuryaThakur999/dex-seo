'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useReducedMotion, type PanInfo } from 'motion/react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { OUTCOME_LABEL, OUTCOME_VARIANT } from '@/lib/guard-outcome-ui';
import { actionTypeLabel, actionTypePlainSummary } from '@/components/review/action-detail';
import { formatRelativeTime } from '@/lib/dashboard-stats';
import { cn } from '@/lib/utils';

export interface ReviewQueueListItem {
  id: string;
  revision: string;
  pageUrl: string;
  actionType: string;
  draftContent: string;
  createdAt: Date;
  guardResult: { outcome: string } | null;
  generationStatus: string;
}

const SWIPE_VELOCITY_THRESHOLD_PX_PER_SEC = 110; // 0.11 px/ms, same threshold used elsewhere this session

export function shouldCommitSwipe(distance: number, velocity: number, revealWidth: number): boolean {
  return Math.abs(distance) > revealWidth * 0.4 || Math.abs(velocity) > SWIPE_VELOCITY_THRESHOLD_PX_PER_SEC;
}

// Extracted so it's testable without rendering the full component (this one uses
// useSearchParams, which needs a real Next.js router context) -- same pattern as
// bottom-nav.tsx's isNavItemActive/formatBadgeCount. Falls back to the raw actionType string
// for a value ACTION_TYPE_LABEL hasn't seen yet, same as ActionDetail's own fallback.
export function actionTypeBadgeLabel(actionType: string): string {
  return actionTypeLabel(actionType);
}

// The full URL (scheme + host + path) left almost no room for the fix-type badge at narrow
// widths, and the truncated text itself showed little past "https://…". The path is the part
// that actually distinguishes one page from another on the same site.
export function pagePathLabel(pageUrl: string): string {
  try {
    const { pathname, search } = new URL(pageUrl);
    return `${pathname}${search}` || '/';
  } catch {
    return pageUrl;
  }
}

export function ReviewQueueList({
  actions,
  selectedActionId,
  hrefBase,
}: {
  actions: ReviewQueueListItem[];
  selectedActionId: string | null;
  /**
   * Overrides the default same-page `?actionId=` link (paired with the desktop sticky
   * detail pane) with `${hrefBase}/${actionId}`. Pass this when the list renders standalone,
   * with no detail pane beside it to update -- e.g. the mobile list, which needs a real
   * navigation to the full-page detail route instead. A string, not a function, because this
   * component is a Client Component rendered from a Server Component page -- function props
   * can't cross that boundary (RSC serialization).
   */
  hrefBase?: string;
}) {
  const [query, setQuery] = useState('');
  const searchParams = useSearchParams();
  const router = useRouter();
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [staleConflicts, setStaleConflicts] = useState<Record<string, { revision: string; message: string }>>({});
  const reduce = useReducedMotion();
  // Set on drag start, cleared a tick after drag end -- lets the row's Link suppress the
  // click Framer Motion's drag system doesn't block on links (see onClick below), while
  // leaving a genuine subsequent tap working normally.
  const didDragRef = useRef(false);

  async function handleQuickDecision(action: ReviewQueueListItem, decision: 'approve' | 'reject') {
    const actionId = action.id;
    setPendingRowId(actionId);
    setRowError(null);
    try {
      const body = new FormData();
      body.set('expectedRevision', action.revision);
      const res = await fetch(`/api/actions/${actionId}/${decision}`, { method: 'POST', body });
      if (res.status === 409) {
        const payload = await res.json().catch(() => null);
        setStaleConflicts(conflicts => ({ ...conflicts, [actionId]: {
          revision: action.revision,
          message: typeof payload?.error === 'string' ? payload.error : 'This change is out of date. Reload the queue before deciding.',
        } }));
        return;
      }
      if (!res.ok) {
        throw new Error(`Could not ${decision} this page. Try again.`);
      }
      // Same routes the detail page already posts to -- on success they redirect server-side
      // for a full page nav, but this is a fetch from a list row, so refresh the list view
      // instead of following that redirect.
      window.location.reload();
    } catch (err) {
      setRowError({
        id: actionId,
        message: err instanceof Error ? err.message : `Could not ${decision} this page. Try again.`,
      });
    } finally {
      setPendingRowId(null);
    }
  }

  const filtered = query.trim()
    ? actions.filter((action) => {
        const haystack = `${action.pageUrl} ${action.draftContent}`.toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      })
    : actions;

  function hrefFor(actionId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('actionId', actionId);
    return `?${params.toString()}`;
  }

  const resolveHref = hrefBase ? (actionId: string) => {
    const params = new URLSearchParams();
    for (const key of ['clientProfileId', 'websiteId', 'type']) {
      const values = searchParams.getAll(key);
      if (values.length === 1 && values[0]) params.set(key, values[0]);
    }
    return `${hrefBase}/${encodeURIComponent(actionId)}${params.size ? '?' + params : ''}`;
  } : hrefFor;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <MagnifyingGlass
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by page or content"
          aria-label="Filter review queue"
          className="h-9 w-full rounded-md border border-[var(--dex-app-border-strong)] bg-transparent pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {actions.length} pending
      </p>

      <ul className="flex flex-col gap-1">
        {filtered.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">No matches.</li>}
        {filtered.map((action) => {
          const isSelected = action.id === selectedActionId;
          const conflict = staleConflicts[action.id];
          const stale = conflict?.revision === action.revision;
          const error = stale ? conflict : rowError?.id === action.id ? rowError : null;
          return (
            <li key={action.id} className="relative overflow-hidden rounded-md">
              <div className="dex-glass-btn absolute inset-y-0 right-0 flex" aria-hidden={openRowId !== action.id}>
                <button
                  type="button"
                  disabled={pendingRowId === action.id || stale}
                  tabIndex={openRowId === action.id ? 0 : -1}
                  onClick={() => {
                    // Row is visually behind the closed panel and not reachable by pointer, but
                    // guard the handler too so a stray synthetic click can't fire it.
                    if (openRowId !== action.id) return;
                    handleQuickDecision(action, 'reject');
                  }}
                  className="flex w-[70px] items-center justify-center bg-destructive/85 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={pendingRowId === action.id || stale}
                  tabIndex={openRowId === action.id ? 0 : -1}
                  onClick={() => {
                    if (openRowId !== action.id) return;
                    handleQuickDecision(action, 'approve');
                  }}
                  className="flex w-[70px] items-center justify-center bg-accent/85 text-xs font-medium text-accent-foreground disabled:opacity-50"
                >
                  Approve
                </button>
              </div>
              <motion.div
                drag="x"
                dragDirectionLock
                dragConstraints={{ left: -140, right: 0 }}
                dragElastic={0.1}
                onDragStart={() => {
                  didDragRef.current = true;
                }}
                animate={{ x: openRowId === action.id ? -140 : 0 }}
                onDragEnd={(_event, info: PanInfo) => {
                  // dragDirectionLock above only gates the visual drag transform -- it does not
                  // affect info.offset/velocity here, which motion-dom's PanSession computes
                  // from raw pointer history regardless of the lock. A vertical scroll with
                  // horizontal noise could still clear shouldCommitSwipe's threshold, so bail
                  // out as a scroll (leave openRowId untouched) whenever the vertical component
                  // dominates -- same guard dashboard-tabs.tsx's handlePanEnd already uses.
                  if (Math.abs(info.offset.y) > Math.abs(info.offset.x)) return;
                  const commit = shouldCommitSwipe(info.offset.x, info.velocity.x, 140);
                  setOpenRowId(commit && info.offset.x < 0 ? action.id : null);
                  // Cleared next tick, not immediately: the browser's post-drag click on the
                  // Link fires after onDragEnd, and needs to still see this as true.
                  setTimeout(() => {
                    didDragRef.current = false;
                  }, 0);
                }}
                transition={reduce ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.3 }}
                className="relative bg-background"
              >
                <Link
                  href={resolveHref(action.id)}
                  scroll={false}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={(event) => {
                    // Framer's drag system doesn't block clicks on links (they have no
                    // click-and-move actions of their own), so a swipe that ends on this
                    // Link also fires a real navigation -- suppress it when a drag just
                    // happened.
                    if (didDragRef.current) event.preventDefault();
                  }}
                  className={cn(
                    'flex min-h-11 flex-col gap-1 rounded-md border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected
                      ? 'border-[var(--dex-app-border-strong)] bg-muted'
                      : 'border-transparent hover:bg-muted/60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-foreground" title={action.pageUrl}>{pagePathLabel(action.pageUrl)}</span>
                    {/* Fix-type label -- with 100+ pending rows, several can share one URL
                        (different actionTypes drafted against the same page) and otherwise look
                        identical until opened. Grouped with the outcome/failed badge so both
                        sit together on the row's right edge. Item 2 (overseer production check,
                        2026-10-16): a plain-language summary leads (not inside Badge's own
                        uppercase styling, wrong for a multi-word phrase), the existing term kept
                        small underneath -- same pattern as ActionDetail and Opportunity Board. */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="text-xs font-medium text-foreground">{actionTypePlainSummary(action.actionType)}</span>
                        <span className="text-[10px] text-muted-foreground">{actionTypeBadgeLabel(action.actionType)}</span>
                      </div>
                      {action.guardResult && (
                        <Badge variant={OUTCOME_VARIANT[action.guardResult.outcome] ?? 'secondary'}>
                          {OUTCOME_LABEL[action.guardResult.outcome] ?? action.guardResult.outcome}
                        </Badge>
                      )}
                      {!action.guardResult && action.generationStatus === 'failed' && (
                        <Badge variant="destructive">Draft failed</Badge>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(action.createdAt)}</span>
                </Link>
              </motion.div>
              {error && (
                <div className="px-3 pt-1">
                  <p role="alert" className="text-xs text-destructive">{error.message}</p>
                  {stale && <button type="button" onClick={() => router.refresh()} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Reload queue</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
