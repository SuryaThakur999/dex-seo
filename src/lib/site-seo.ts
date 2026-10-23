import { FAQ } from '@/components/marketing/faq-content';

// Public origin for canonical URLs, robots.txt and the sitemap. Override once a real domain exists.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dex-ai-plum.vercel.app').replace(/\/$/, '');

export const SITE_TITLE = 'Dex: the AI marketing team you stay in charge of';
export const SITE_DESCRIPTION =
  'Dex checks every page of your website, finds SEO and AI-search problems, and drafts fixes you approve before anything changes.';

// Only facts that are true today: no address, founding date or legal entity until the Impressum is final.
export function homepageJsonLd() {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Dex',
      url: SITE_URL,
      logo: `${SITE_URL}/brand/dex-logo-transparent.png`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Dex',
      url: SITE_URL,
      description: SITE_DESCRIPTION,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ];
}
