import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-seo';
import { LEGAL_COMPLETE } from '@/lib/legal/operator';

// The homepage plus the legal pages, which join once their placeholders are filled in.
// Sign-in and sign-up are noindex.
export default function sitemap(): MetadataRoute.Sitemap {
  const legal = LEGAL_COMPLETE
    ? ['/privacy', '/terms', '/dpa', '/security', '/cookies'].map((path) => ({
        url: `${SITE_URL}${path}`,
        changeFrequency: 'yearly' as const,
        priority: 0.3,
      }))
    : [];
  return [{ url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 }, ...legal];
}
