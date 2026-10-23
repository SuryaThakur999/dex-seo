import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { listVerifiedSites, GoogleAuthError, GoogleConfigError } from '@/lib/gsc-client';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const form = await req.formData();
  const siteUrl = form.get('siteUrl');
  const websiteId = form.get('websiteId');
  if (typeof siteUrl !== 'string' || !siteUrl) {
    return NextResponse.json({ error: 'Missing siteUrl' }, { status: 400 });
  }

  let website;
  try {
    ({ website } = await resolveWebsiteForRequest(userId, typeof websiteId === 'string' ? websiteId : undefined));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }
  if (!website.gscRefreshToken) {
    return NextResponse.json({ error: 'Connect Google Search Console first' }, { status: 400 });
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(website.gscRefreshToken);
  } catch (err) {
    console.error(`select-site: decrypt failed for website ${website.id}`, err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "This site's Search Console connection is corrupted. Reconnect Google Search Console." },
      { status: 500 }
    );
  }

  let verifiedSites: string[];
  try {
    verifiedSites = await listVerifiedSites(refreshToken);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      // Google confirmed the refresh token itself is dead — keep the
      // credential row (a fresh OAuth completion overwrites it on success;
      // deleting it here would only lose the property/config context for
      // no benefit) and flag reconnect so Settings shows the right action
      // instead of a stale "connected" badge.
      await db.website.updateMany({
        where: { id: website.id, gscRefreshToken: website.gscRefreshToken },
        data: { gscReconnectRequired: true },
      });
      return NextResponse.json(
        { error: 'Your Search Console connection for this site is no longer valid. Reconnect Google Search Console.' },
        { status: 400 }
      );
    }
    if (err instanceof GoogleConfigError) {
      // Dex's own OAuth client credentials were rejected, not the
      // customer's token — reconnecting won't fix this, so don't ask the
      // customer to and don't touch their stored credential.
      console.error(`select-site: Google OAuth client rejected for website ${website.id}`, err.message);
      return NextResponse.json(
        { error: 'Search Console is temporarily unavailable due to a configuration issue on our end. We have been notified.' },
        { status: 503 }
      );
    }
    console.error(`select-site: listVerifiedSites failed for website ${website.id}`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Google Search Console is temporarily unavailable. Try again shortly.' }, { status: 503 });
  }

  if (!verifiedSites.includes(siteUrl)) {
    return NextResponse.json(
      { error: 'Not a verified Search Console property for this account' },
      { status: 400 }
    );
  }

  try {
    await db.website.update({
      where: { id: website.id },
      data: { gscPropertyUrl: siteUrl, gscReconnectRequired: false },
    });
  } catch (err) {
    console.error(`select-site: db update failed for website ${website.id}`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to save the selected property. Try again.' }, { status: 500 });
  }

  return NextResponse.redirect(new URL('/settings', req.url), 303);
}
