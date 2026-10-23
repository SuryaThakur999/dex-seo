import { describe, it, expect, vi } from 'vitest';
import { isAllowedByRobots, parsePageMeta, parseSeoSignals, throttle, fetchPageMeta, fetchHtml, fetchHtmlWithStatus, extractInternalLinks, extractSocialProfileLinks, hasEntityMarkup, isSitemapUrl, extractBodyText, isAuthOrAccountPath, hasNoindexMeta } from './crawler';

describe('extractBodyText', () => {
  it('returns readable body text with whitespace collapsed', () => {
    const html = '<html><body>  <p>Hello   world.</p>\n<p>We serve hotels.</p>  </body></html>';
    expect(extractBodyText(html)).toBe('Hello world. We serve hotels.');
  });

  it('strips script, style, nav and footer content', () => {
    const html = `<html><body>
      <nav>Home About</nav>
      <script>trackPageView();</script>
      <style>.hero { color: red; }</style>
      <p>Real marketing copy.</p>
      <footer>Copyright 2026</footer>
    </body></html>`;
    expect(extractBodyText(html)).toBe('Real marketing copy.');
  });

  it('caps body text length', () => {
    const html = `<html><body>${'x'.repeat(25_000)}</body></html>`;
    expect(extractBodyText(html).length).toBe(20_000);
  });
});

describe('hasEntityMarkup', () => {
  it('detects Organization JSON-LD', () => {
    const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script></head></html>`;
    expect(hasEntityMarkup(html)).toBe(true);
  });

  it('detects an entity type inside a JSON-LD array', () => {
    const html = `<html><head><script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"WebSite","name":"Acme"}]</script></head></html>`;
    expect(hasEntityMarkup(html)).toBe(true);
  });

  it('returns false when JSON-LD exists but declares no entity type (e.g. only Article/Product)', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Article","headline":"A post"}</script></head></html>`;
    expect(hasEntityMarkup(html)).toBe(false);
  });

  it('returns false when there is no JSON-LD at all', () => {
    expect(hasEntityMarkup('<html><head></head><body>hi</body></html>')).toBe(false);
  });

  it('does not throw on malformed JSON-LD — skips the block instead', () => {
    const html = `<html><head><script type="application/ld+json">{not valid json</script></head></html>`;
    expect(hasEntityMarkup(html)).toBe(false);
  });
});

describe('parsePageMeta', () => {
  it('extracts the title, meta description, and h1 from HTML', () => {
    const html = `
      <html><head>
        <title>Example Page</title>
        <meta name="description" content="An example page for testing.">
      </head><body>
        <h1>Example Heading</h1>
      </body></html>
    `;
    expect(parsePageMeta(html)).toEqual({
      title: 'Example Page',
      metaDescription: 'An example page for testing.',
      h1: 'Example Heading',
    });
  });

  it('returns nulls when title, meta description, or h1 are missing', () => {
    expect(parsePageMeta('<html><head></head></html>')).toEqual({
      title: null,
      metaDescription: null,
      h1: null,
    });
  });

  it('matches a meta description tag with an uppercase name attribute', () => {
    const html = '<html><head><meta name="Description" content="Case insensitive match."></head></html>';
    expect(parsePageMeta(html).metaDescription).toBe('Case insensitive match.');
  });
});

describe('parseSeoSignals', () => {
  const PAGE_URL = 'https://example.com/pricing';

  it('extracts the canonical URL, structured data presence, and internal link count', () => {
    const html = `
      <html><head>
        <link rel="canonical" href="https://example.com/pricing">
        <script type="application/ld+json">{"@type":"Product"}</script>
      </head><body>
        <a href="/about">About</a>
        <a href="https://example.com/contact">Contact</a>
        <a href="https://other-site.com/page">External</a>
      </body></html>
    `;
    expect(parseSeoSignals(html, PAGE_URL)).toEqual({
      canonicalUrl: 'https://example.com/pricing',
      hasStructuredData: true,
      internalLinkCount: 2,
    });
  });

  it('returns null canonical, false structured data, and zero links when none are present', () => {
    expect(parseSeoSignals('<html><head></head><body></body></html>', PAGE_URL)).toEqual({
      canonicalUrl: null,
      hasStructuredData: false,
      internalLinkCount: 0,
    });
  });

  it('matches a canonical link tag with an uppercase rel attribute', () => {
    const html = '<html><head><link rel="CANONICAL" href="https://example.com/pricing"></head></html>';
    expect(parseSeoSignals(html, PAGE_URL).canonicalUrl).toBe('https://example.com/pricing');
  });
});

describe('isAllowedByRobots', () => {
  it('disallows a path blocked in robots.txt', async () => {
    const fetchRobotsTxt = vi.fn().mockResolvedValue('User-agent: *\nDisallow: /admin');
    const allowed = await isAllowedByRobots('https://example.com/admin/page', fetchRobotsTxt);
    expect(allowed).toBe(false);
  });

  it('allows a path not blocked in robots.txt', async () => {
    const fetchRobotsTxt = vi.fn().mockResolvedValue('User-agent: *\nDisallow: /admin');
    const allowed = await isAllowedByRobots('https://example.com/blog/post', fetchRobotsTxt);
    expect(allowed).toBe(true);
  });
});

describe('throttle', () => {
  it('waits at least minIntervalMs between two calls for the same hostname', async () => {
    await throttle('throttle-timing.example.com', 50);
    const start = Date.now();
    await throttle('throttle-timing.example.com', 50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

describe('fetchPageMeta', () => {
  it('does not fetch the page and returns nulls when robots.txt disallows it', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      throw new Error('should not fetch a disallowed page');
    });

    const result = await fetchPageMeta('https://blocked-path.example.com/blocked/page', fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ title: null, metaDescription: null, h1: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches and parses meta for a page robots.txt allows', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      return {
        ok: true,
        text: async () =>
          '<html><head><title>Allowed</title><meta name="description" content="OK page."></head><body><h1>Allowed Heading</h1></body></html>',
      } as Response;
    });

    const result = await fetchPageMeta('https://allowed-path.example.com/blog/post', fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ title: 'Allowed', metaDescription: 'OK page.', h1: 'Allowed Heading' });
  });

  it('reuses a cached robots.txt across multiple pages on the same origin', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      return {
        ok: true,
        text: async () => '<html><head><title>Page</title></head></html>',
      } as Response;
    });

    await fetchPageMeta('https://cache-check.example.com/page-one', fetchImpl as unknown as typeof fetch);
    await fetchPageMeta('https://cache-check.example.com/page-two', fetchImpl as unknown as typeof fetch);

    const robotsTxtCalls = fetchImpl.mock.calls.filter(([url]) => (url as string).endsWith('/robots.txt'));
    expect(robotsTxtCalls).toHaveLength(1); // cached on the second call, not re-fetched
  });
});

describe('fetchHtml', () => {
  it('does not fetch the page and returns null when robots.txt disallows it', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      throw new Error('should not fetch a disallowed page');
    });

    const result = await fetchHtml('https://blocked-html.example.com/blocked/page', fetchImpl as unknown as typeof fetch);

    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches and returns the raw HTML for a page robots.txt allows', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      return { ok: true, text: async () => '<html><body>hello</body></html>' } as Response;
    });

    const result = await fetchHtml('https://allowed-html.example.com/page', fetchImpl as unknown as typeof fetch);

    expect(result).toBe('<html><body>hello</body></html>');
  });
});

describe('fetchHtmlWithStatus', () => {
  it('reports blockedByRobots with no status when robots.txt disallows the page', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { ok: true, text: async () => 'User-agent: *\nDisallow: /blocked' } as Response;
      }
      throw new Error('should not fetch a disallowed page');
    });

    const result = await fetchHtmlWithStatus('https://blocked-status.example.com/blocked/page', fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ html: null, status: null, blockedByRobots: true });
  });

  it('reports the real status code and null html for a non-2xx response', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return { ok: true, text: async () => '' } as Response;
      return { ok: false, status: 404, text: async () => 'Not Found' } as Response;
    });

    const result = await fetchHtmlWithStatus('https://status-404.example.com/gone', fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ html: null, status: 404, blockedByRobots: false });
  });

  it('returns the real status and html together for a successful response', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return { ok: true, text: async () => '' } as Response;
      return { ok: true, status: 200, text: async () => '<html>ok</html>' } as Response;
    });

    const result = await fetchHtmlWithStatus('https://status-200.example.com/page', fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ html: '<html>ok</html>', status: 200, blockedByRobots: false });
  });

  it('reports no status on a network/timeout exception, never a guessed value', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return { ok: true, text: async () => '' } as Response;
      throw new Error('network error');
    });

    const result = await fetchHtmlWithStatus('https://status-network-fail.example.com/page', fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ html: null, status: null, blockedByRobots: false });
  });
});

describe('isAuthOrAccountPath', () => {
  it.each(['/sign-in', '/signin', '/sign-up', '/signup', '/log-in', '/login', '/account', '/account/orders', '/register', '/cart', '/checkout'])(
    'treats %s as an auth/account path',
    (path) => expect(isAuthOrAccountPath(`https://example.com${path}`)).toBe(true),
  );

  it.each(['/', '/about', '/blog/login-tips', '/products'])(
    'does not treat %s as an auth/account path',
    (path) => expect(isAuthOrAccountPath(`https://example.com${path}`)).toBe(false),
  );

  it('returns false for an unparseable URL instead of throwing', () => {
    expect(isAuthOrAccountPath('not a url')).toBe(false);
  });
});

describe('hasNoindexMeta', () => {
  it('detects a noindex meta robots tag', () => {
    expect(hasNoindexMeta('<html><head><meta name="robots" content="noindex, nofollow"></head></html>')).toBe(true);
  });

  it('is case-insensitive on the tag name and token', () => {
    expect(hasNoindexMeta('<html><head><meta name="Robots" content="NOINDEX"></head></html>')).toBe(true);
  });

  it('returns false when there is no robots meta tag or it allows indexing', () => {
    expect(hasNoindexMeta('<html><head></head></html>')).toBe(false);
    expect(hasNoindexMeta('<html><head><meta name="robots" content="index, follow"></head></html>')).toBe(false);
  });
});

describe('isSitemapUrl', () => {
  it('matches a plain .xml URL, case-insensitively', () => {
    expect(isSitemapUrl('https://example.com/sitemap.xml')).toBe(true);
    expect(isSitemapUrl('https://example.com/page-sitemap.XML')).toBe(true);
  });

  it('matches a gzipped sitemap URL', () => {
    expect(isSitemapUrl('https://example.com/sitemap.xml.gz')).toBe(true);
  });

  it('does not match a real HTML page URL', () => {
    expect(isSitemapUrl('https://example.com/about')).toBe(false);
    expect(isSitemapUrl('https://example.com/pricing.html')).toBe(false);
  });

  it('returns false instead of throwing for an unparseable URL', () => {
    expect(isSitemapUrl('not-a-url')).toBe(false);
  });
});

describe('extractInternalLinks', () => {
  it('extracts absolute and relative same-hostname links, resolving relative ones against baseUrl', () => {
    const html = `
      <html><body>
        <a href="/about">About</a>
        <a href="https://example.com/contact">Contact</a>
        <a href="pricing">Pricing</a>
      </body></html>
    `;
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links.sort()).toEqual([
      'https://example.com/about',
      'https://example.com/contact',
      'https://example.com/pricing',
    ]);
  });

  it('excludes a link to a different hostname', () => {
    const html = '<a href="https://other-site.com/page">External</a><a href="/local">Local</a>';
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links).toEqual(['https://example.com/local']);
  });

  it('excludes mailto, javascript, and tel hrefs', () => {
    const html = `
      <a href="mailto:hi@example.com">Email</a>
      <a href="javascript:void(0)">JS</a>
      <a href="tel:+15551234567">Call</a>
      <a href="/real-page">Real</a>
    `;
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links).toEqual(['https://example.com/real-page']);
  });

  it('dedupes the same page reached via different hash fragments', () => {
    const html = '<a href="/page#section-a">A</a><a href="/page#section-b">B</a>';
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links).toEqual(['https://example.com/page']);
  });

  it('returns an empty array for HTML with no anchor tags', () => {
    const links = extractInternalLinks('<html><body><p>No links here.</p></body></html>', 'https://example.com/');
    expect(links).toEqual([]);
  });
});

describe('extractSocialProfileLinks (social-profile-discovery plan, 2026-10-17)', () => {
  it('extracts social links from anchors and JSON-LD sameAs, ignoring unrelated external links', () => {
    const html = `
      <footer><a href="https://www.linkedin.com/company/acme">LinkedIn</a><a href="https://unrelated-blog.test/post">Source</a></footer>
      <script type="application/ld+json">{"@type":"Organization","sameAs":["https://www.instagram.com/acme"]}</script>
    `;
    const links = extractSocialProfileLinks(html, 'https://acme.test');
    expect(links).toEqual(expect.arrayContaining([
      { platform: 'linkedin', url: 'https://www.linkedin.com/company/acme' },
      { platform: 'instagram', url: 'https://www.instagram.com/acme' },
    ]));
    expect(links.find((l) => l.url.includes('unrelated-blog'))).toBeUndefined();
  });

  it('maps x.com and twitter.com both to the x platform', () => {
    const html = '<a href="https://twitter.com/acme">Twitter</a><a href="https://x.com/acme2">X</a>';
    const links = extractSocialProfileLinks(html, 'https://acme.test');
    expect(links).toEqual(expect.arrayContaining([
      { platform: 'x', url: 'https://twitter.com/acme' },
      { platform: 'x', url: 'https://x.com/acme2' },
    ]));
  });

  it('deduplicates identical platform+url pairs found in both anchors and sameAs', () => {
    const html = `
      <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
      <script type="application/ld+json">{"sameAs":["https://www.linkedin.com/company/acme"]}</script>
    `;
    expect(extractSocialProfileLinks(html, 'https://acme.test')).toHaveLength(1);
  });

  it('does not throw on malformed JSON-LD', () => {
    const html = '<script type="application/ld+json">{not valid json</script><a href="https://www.tiktok.com/@acme">TikTok</a>';
    expect(() => extractSocialProfileLinks(html, 'https://acme.test')).not.toThrow();
    expect(extractSocialProfileLinks(html, 'https://acme.test')).toEqual([{ platform: 'tiktok', url: 'https://www.tiktok.com/@acme' }]);
  });

  it('returns an empty array when no social links are present', () => {
    expect(extractSocialProfileLinks('<p>Nothing here.</p>', 'https://acme.test')).toEqual([]);
  });
});
