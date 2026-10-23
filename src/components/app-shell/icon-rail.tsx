'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { websiteScopedHref } from '@/lib/nav-href';
import { SquaresFour, ListChecks, NotePencil, Gear } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DexSignalMark } from './dex-signal-mark';
import { cn } from '@/lib/utils';

const LAST_WEBSITE_ID_KEY = 'dex:lastWebsiteId';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Mission Control', icon: SquaresFour },
  { href: '/studio', label: 'Content Studio', icon: NotePencil },
  { href: '/review', label: 'Review', icon: ListChecks },
  { href: '/settings', label: 'Settings', icon: Gear },
];

export function IconRail({ pendingReviewCount = 0 }: { pendingReviewCount?: number }) {
  const pathname = usePathname();
  // Bare `/dashboard` always redirects server-side to the oldest-created website (see
  // resolveWebsiteForRequest) — without this, leaving the dashboard for Studio/Review/
  // Settings and clicking back silently switches the user's site away from whatever they
  // were actually looking at. Remembered client-side since Studio/Review/Settings don't
  // carry the websiteId in their URL path.
  const [lastWebsiteId, setLastWebsiteId] = useState<string | null>(null);

  useEffect(() => {
    const match = pathname.match(/^\/dashboard\/([^/]+)/);
    if (match) {
      setLastWebsiteId(match[1]);
      try {
        localStorage.setItem(LAST_WEBSITE_ID_KEY, match[1]);
      } catch {
        // Private browsing / blocked storage — losing the memory is a minor inconvenience,
        // not worth failing navigation over.
      }
    } else if (lastWebsiteId === null) {
      try {
        setLastWebsiteId(localStorage.getItem(LAST_WEBSITE_ID_KEY));
      } catch {
        // No memory available — the Dashboard link falls back to the plain `/dashboard`
        // redirect below, same as first-ever visit.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const navItems = NAV_ITEMS.map((item) =>
    websiteScopedHref(item, lastWebsiteId)
  );

  return (
    <aside className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r border-border py-6 sm:flex">
      <div className="mb-6 flex flex-col items-center gap-1">
        <DexSignalMark size={28} />
        <span className="text-[10px] font-extrabold tracking-wide text-[#FD4C00]">DEX</span>
      </div>
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                className={cn(
                  'relative flex h-11 w-11 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isActive ? 'bg-muted text-accent' : 'text-muted-foreground'
                )}
              >
                <item.icon size={20} weight="regular" aria-hidden="true" />
                {item.href === '/review' && pendingReviewCount > 0 && (
                  <span
                    className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground"
                    aria-hidden="true"
                  >
                    {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                  </span>
                )}
                <span className="sr-only">
                  {item.label}
                  {item.href === '/review' && pendingReviewCount > 0 ? ` (${pendingReviewCount} pending)` : ''}
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </aside>
  );
}
