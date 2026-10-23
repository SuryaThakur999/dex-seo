import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildAuthUrl, exchangeCodeForRefreshToken } from './google-oauth';
import { GoogleAuthError, GoogleConfigError } from './gsc-client';

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/gsc/callback';
});

// exchangeCodeForRefreshToken's own error classification (the 2026-09-17 fix -- it previously
// let a raw googleapis error escape uncaught, so an invalid_client/invalid_grant failure during
// code exchange fell through to a generic "Failed to connect Google Search Console." in the
// callback route instead of the same clear GoogleConfigError/GoogleAuthError message every
// other Google API call site already produces).
const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));
vi.mock('googleapis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('googleapis')>();
  const { OAuth2 } = actual.google.auth;
  return {
    ...actual,
    google: {
      ...actual.google,
      auth: {
        ...actual.google.auth,
        // Real OAuth2 instance (so buildAuthUrl's generateAuthUrl keeps working unmocked),
        // with getToken swapped for a controllable mock -- the only method this fix touches.
        OAuth2: vi.fn((...args: ConstructorParameters<typeof OAuth2>) => {
          const real = new OAuth2(...args);
          return Object.assign(real, { getToken: mockGetToken });
        }),
      },
    },
  };
});

describe('buildAuthUrl', () => {
  it('requests only the read-only webmasters scope', () => {
    const url = buildAuthUrl('some-state');
    expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fwebmasters.readonly');
  });

  it('includes the provided state parameter', () => {
    const url = buildAuthUrl('some-state');
    expect(url).toContain('state=some-state');
  });

  it('requests offline access so a refresh token is returned', () => {
    const url = buildAuthUrl('some-state');
    expect(url).toContain('access_type=offline');
  });

  it('requests consent prompt so a refresh token is reliably returned on reconnect', () => {
    const url = buildAuthUrl('some-state');
    expect(url).toContain('prompt=consent');
  });
});

describe('exchangeCodeForRefreshToken', () => {
  it('returns the refresh token on a normal successful exchange', async () => {
    mockGetToken.mockResolvedValueOnce({ tokens: { refresh_token: 'a-real-refresh-token' } });
    await expect(exchangeCodeForRefreshToken('some-code')).resolves.toBe('a-real-refresh-token');
  });

  it('throws GoogleConfigError when Google rejects invalid_client during code exchange', async () => {
    mockGetToken.mockRejectedValueOnce({ response: { data: { error: 'invalid_client' } } });
    await expect(exchangeCodeForRefreshToken('some-code')).rejects.toThrow(GoogleConfigError);
  });

  it('throws GoogleConfigError when Google rejects unauthorized_client during code exchange', async () => {
    mockGetToken.mockRejectedValueOnce({ response: { data: { error: 'unauthorized_client' } } });
    await expect(exchangeCodeForRefreshToken('some-code')).rejects.toThrow(GoogleConfigError);
  });

  it('throws GoogleAuthError when Google rejects invalid_grant (an expired or reused code)', async () => {
    mockGetToken.mockRejectedValueOnce({ response: { data: { error: 'invalid_grant' } } });
    await expect(exchangeCodeForRefreshToken('some-code')).rejects.toThrow(GoogleAuthError);
  });

  it('rethrows an unrecognized error unchanged rather than guessing', async () => {
    const original = new Error('network timeout');
    mockGetToken.mockRejectedValueOnce(original);
    await expect(exchangeCodeForRefreshToken('some-code')).rejects.toThrow(original);
  });

  it('throws a plain Error when Google succeeds but returns no refresh_token', async () => {
    mockGetToken.mockResolvedValueOnce({ tokens: {} });
    await expect(exchangeCodeForRefreshToken('some-code')).rejects.toThrow(/refresh_token/);
  });
});
