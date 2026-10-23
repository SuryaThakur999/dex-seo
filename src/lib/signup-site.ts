import { PENDING_WEBSITE_URL } from '@/lib/customer';
import { defaultStudioWebsite, isPendingWebsite } from '@/lib/website-selection';

type Site = { id: string; url: string };

export function parseSignupSite(value?: string | string[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const input = value.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    if (url.hostname === new URL(PENDING_WEBSITE_URL).hostname) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function signupRedirect(value?: string | string[]): string {
  const site = parseSignupSite(value);
  return site ? `/settings?site=${encodeURIComponent(site)}` : '/dashboard';
}

function host(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function signupSitePrefill<T extends Site>(
  resolved: T,
  websites: T[],
  value?: string | string[],
  requested?: string,
): { selected: T; initialUrl: string; pendingId?: string } {
  const selected = defaultStudioWebsite(resolved, websites, requested);
  const initialUrl = parseSignupSite(value);
  if (!initialUrl) return { selected, initialUrl: '' };
  const confirmed = websites.filter((site) => !isPendingWebsite(site));
  const matching = confirmed.find((site) => host(site.url) === host(initialUrl));
  if (matching) return { selected: requested ? selected : matching, initialUrl: '' };
  const pending = confirmed.length === 0 ? websites.find(isPendingWebsite) : undefined;
  return { selected, initialUrl, ...(pending ? { pendingId: pending.id } : {}) };
}
