import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForRefreshToken } from '@/lib/google-oauth';
import { encrypt } from '@/lib/crypto';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';
import { GoogleAuthError, GoogleConfigError } from '@/lib/gsc-client';

export async function GET(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const oauthError = requestUrl.searchParams.get('error');
  const expectedState = req.cookies.get('gsc_oauth_state')?.value;
  const websiteId = req.cookies.get('gsc_oauth_website_id')?.value;

  // Google redirects here with `?error=...` instead of `?code=...` for two real cases:
  // the customer clicked "Deny" on the consent screen (`access_denied` — a normal choice,
  // not a failure), or some other authorization-server-side rejection. `redirect_uri_mismatch`
  // is NOT reachable here: Google refuses to redirect to an unregistered URI at all, so that
  // failure shows on Google's own error page and can only be diagnosed in Google Cloud
  // Console, never from this route's code.
  if (oauthError) {
    if (oauthError === 'access_denied') {
      return NextResponse.redirect(new URL('/settings?gsc=declined', req.url));
    }
    console.error(`gsc/callback: Google returned OAuth error "${oauthError}" for website ${websiteId}`);
    return NextResponse.redirect(new URL('/settings?gsc=error', req.url));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response('Invalid OAuth callback', { status: 400 });
  }
  if (!websiteId) {
    return NextResponse.json({ error: 'Missing website reference — start the connect flow again.' }, { status: 400 });
  }

  try {
    const refreshToken = await exchangeCodeForRefreshToken(code);
    const { website } = await resolveWebsiteForRequest(userId, websiteId);

    await db.website.update({
      where: { id: website.id },
      data: { gscRefreshToken: encrypt(refreshToken), gscReconnectRequired: false },
    });
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found — start the connect flow again.' }, { status: 400 });
    }
    if (err instanceof GoogleConfigError) {
      // Same as select-site/route.ts: Dex's own OAuth client credentials were rejected, not
      // anything the customer did -- retrying the connect flow won't fix this.
      console.error(`gsc/callback: Google OAuth client rejected for website ${websiteId}`, err.message);
      return NextResponse.json(
        { error: 'Search Console is temporarily unavailable due to a configuration issue on our end. We have been notified.' },
        { status: 503 }
      );
    }
    if (err instanceof GoogleAuthError) {
      return NextResponse.json(
        { error: 'That connection attempt expired or was already used. Try connecting again.' },
        { status: 400 }
      );
    }
    if (err instanceof Error && err.message.includes('refresh_token')) {
      return NextResponse.json(
        { error: 'Google did not return a refresh token. Revoke prior access at myaccount.google.com/permissions and try again.' },
        { status: 400 }
      );
    }
    console.error(`gsc/callback: unexpected failure for website ${websiteId}`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to connect Google Search Console.' }, { status: 500 });
  }

  const response = NextResponse.redirect(new URL('/settings', req.url));
  response.cookies.delete('gsc_oauth_state');
  response.cookies.delete('gsc_oauth_website_id');
  return response;
}
