import { describe, it, expect } from 'vitest';
import { matchesRoute, redactUrl, DEX_OWNED_ROUTES } from './reconcile-qstash-schedule';

const scanRoute = DEX_OWNED_ROUTES.find((r) => r.path === '/api/scan/process')!;

describe('matchesRoute', () => {
  it('matches a schedule with the right path and method, no base URL given', () => {
    expect(matchesRoute('https://dex-ai-plum.vercel.app/api/scan/process', 'GET', scanRoute, null)).toBe(true);
  });

  it('matches regardless of host when no expected base URL is given (reduced-confidence mode)', () => {
    expect(matchesRoute('https://some-other-host.example.com/api/scan/process', 'GET', scanRoute, null)).toBe(true);
  });

  it('rejects a mismatched host when an expected base URL is given', () => {
    expect(matchesRoute('https://some-other-host.example.com/api/scan/process', 'GET', scanRoute, 'https://dex-ai-plum.vercel.app')).toBe(false);
  });

  it('accepts a matching host when an expected base URL is given', () => {
    expect(matchesRoute('https://dex-ai-plum.vercel.app/api/scan/process', 'GET', scanRoute, 'https://dex-ai-plum.vercel.app')).toBe(true);
  });

  it('rejects a mismatched path', () => {
    expect(matchesRoute('https://dex-ai-plum.vercel.app/api/generation/process', 'GET', scanRoute, null)).toBe(false);
  });

  it('rejects a mismatched HTTP method', () => {
    expect(matchesRoute('https://dex-ai-plum.vercel.app/api/scan/process', 'POST', scanRoute, null)).toBe(false);
  });

  it('rejects an unparseable destination rather than throwing', () => {
    expect(matchesRoute('not-a-url', 'GET', scanRoute, null)).toBe(false);
  });
});

describe('redactUrl', () => {
  it('keeps protocol, host, and path, drops query string and fragment', () => {
    expect(redactUrl('https://dex-ai-plum.vercel.app/api/scan/process?token=secret#frag')).toBe(
      'https://dex-ai-plum.vercel.app/api/scan/process'
    );
  });

  it('returns a placeholder for an unparseable URL instead of throwing', () => {
    expect(redactUrl('not-a-url')).toBe('<unparseable-url>');
  });
});
