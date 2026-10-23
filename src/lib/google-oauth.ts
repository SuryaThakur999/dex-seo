import { google } from 'googleapis';
import { classifyGoogleFailure, GoogleAuthError, GoogleConfigError } from '@/lib/gsc-client';

const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export function client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function buildAuthUrl(state: string): string {
  return client().generateAuthUrl({
    access_type: 'offline',
    scope: [READONLY_SCOPE],
    state,
    prompt: 'consent',
  });
}

export async function exchangeCodeForRefreshToken(code: string): Promise<string> {
  let tokens;
  try {
    ({ tokens } = await client().getToken(code));
  } catch (err) {
    // Same classification gsc-client.ts already applies to every other Google API call --
    // an invalid_client/unauthorized_client here means Dex's own OAuth client credentials
    // were rejected during code exchange, before the customer's authorization is ever
    // evaluated. Without this, that case fell through to a generic, unhelpful 500 in the
    // callback route (confirmed live 2026-09-17: reported when connecting yoki-ai-fintech
    // to GSC, same underlying "Dex's Google OAuth client configuration was rejected" cause
    // already visible in scan logs across multiple other real sites this session).
    const kind = classifyGoogleFailure(err);
    if (kind === 'config') throw new GoogleConfigError("Dex's Google OAuth client configuration was rejected");
    if (kind === 'token') throw new GoogleAuthError('Google rejected this authorization code');
    throw err;
  }
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token — user may need to revoke prior access and reconnect');
  }
  return tokens.refresh_token;
}
