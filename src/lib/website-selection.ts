import { PENDING_WEBSITE_URL } from '@/lib/customer';

type Site = { id: string; url: string };

export function isPendingWebsite(site: Site): boolean {
  return site.url === PENDING_WEBSITE_URL;
}

/** Websites a user can pick in Content Studio: the sign-up placeholder is never a real target. */
export function selectableWebsites<T extends Site>(websites: T[]): T[] {
  return websites.filter((site) => !isPendingWebsite(site));
}

/**
 * Studio's website when the URL names none. The resolver's default is the oldest website,
 * which for most accounts is the sign-up placeholder, so prefer the first confirmed site.
 */
export function defaultStudioWebsite<T extends Site>(resolved: T, websites: T[], requested?: string): T {
  if (requested || !isPendingWebsite(resolved)) return resolved;
  return selectableWebsites(websites)[0] ?? resolved;
}
