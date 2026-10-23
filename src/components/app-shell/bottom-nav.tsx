'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { websiteScopedHref } from '@/lib/nav-href';
import { motion, useReducedMotion } from 'motion/react';
import { SquaresFour, ListChecks, NotePencil, Gear } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const LAST_WEBSITE_ID_KEY = 'dex:lastWebsiteId';

// Pure logic pulled out of the component so it's testable without rendering
// through React (BottomNav uses hooks — see bottom-nav.test.tsx for why).
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

// Labels match the icon rail's, but shortened for a narrow tab bar (mirrors the
// design reference's mobile nav: Mission / Studio / Review / Settings).
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Mission', icon: SquaresFour },
  { href: '/studio', label: 'Studio', icon: NotePencil },
  { href: '/review', label: 'Review', icon: ListChecks },
  { href: '/settings', label: 'Settings', icon: Gear },
];

// DEX CONTINUATION MASTER DIRECTIVE Phase 5A: "On mobile, replace the permanent left icon
// rail with a labelled bottom navigation. Ensure every primary touch target is at least
// 44x44 pixels and remains above browser safe areas." Renders alongside IconRail (which
// hides itself on mobile via Tailwind breakpoints) rather than replacing it structurally —
// see AppShellNav.
export function BottomNav({ pendingReviewCount = 0 }: { pendingReviewCount?: number }) {
  const pathname = usePathname();
  const [lastWebsiteId, setLastWebsiteId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const reduce = useReducedMotion();

  // A route change should always reveal the nav -- without this, navigating mid-scroll
  // (hidden state carried over from the previous page) can strand it hidden on a fresh
  // page the user hasn't scrolled on yet.
  useEffect(() => {
    setHidden(false);
  }, [pathname]);

  useEffect(() => {
    const match = pathname.match(/^\/dashboard\/([^/]+)/);
    if (match) {
      setLastWebsiteId(match[1]);
      try {
        localStorage.setItem(LAST_WEBSITE_ID_KEY, match[1]);
      } catch {
        // Private browsing / blocked storage — same fallback as IconRail.
      }
    } else if (lastWebsiteId === null) {
      try {
        setLastWebsiteId(localStorage.getItem(LAST_WEBSITE_ID_KEY));
      } catch {
        // No memory available.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let ticking = false;

    function handleScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const delta = currentScrollY - lastScrollY;
        if (currentScrollY <= 0) {
          setHidden(false);
        } else if (delta > 10) {
          setHidden(true);
        } else if (delta < 0) {
          setHidden(false);
        }
        lastScrollY = currentScrollY;
        ticking = false;
      });
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = NAV_ITEMS.map((item) =>
    websiteScopedHref(item, lastWebsiteId)
  );

  return (
    <nav
      className={cn(
        'dex-glass fixed inset-x-0 bottom-0 z-40 flex border-t border-border transition-transform duration-200 ease-out sm:hidden',
        hidden ? 'translate-y-full' : 'translate-y-0'
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="dex-glass relative mx-auto flex w-full max-w-sm rounded-full p-1">
        {navItems.map((item) => {
          const isActive = isNavItemActive(pathname, item.href);
          const badge = item.href === '/review' ? formatBadgeCount(pendingReviewCount) : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative z-10 flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2 text-[11px] font-medium transition-colors',
                isActive ? 'text-accent' : 'text-muted-foreground'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-thumb"
                  className="absolute inset-0 -z-10 rounded-full bg-accent/15"
                  transition={reduce ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.3 }}
                />
              )}
              <item.icon size={22} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
              {badge && (
                <span
                  className="absolute right-[calc(50%-20px)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground"
                  aria-hidden="true"
                >
                  {badge}
                </span>
              )}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
