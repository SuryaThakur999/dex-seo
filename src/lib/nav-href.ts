// Studio, Review and Settings read the website from `?websiteId=`. Without it they fall back to
// the customer's oldest website, which can belong to a different company than the one the
// owner was just looking at (a competitor added "for Yoki" landed on another company).
export function websiteScopedHref<T extends { href: string }>(item: T, lastWebsiteId: string | null): T {
  if (!lastWebsiteId) return item;
  if (item.href === '/dashboard') return { ...item, href: `/dashboard/${lastWebsiteId}` };
  if (item.href === '/studio' || item.href === '/review' || item.href === '/settings') {
    return { ...item, href: `${item.href}?websiteId=${encodeURIComponent(lastWebsiteId)}` };
  }
  return item;
}
