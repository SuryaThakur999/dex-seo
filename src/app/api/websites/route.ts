import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveWebsiteForRequest } from '@/lib/customer';
import {
  createWebsiteWithEntitlementCheck,
  createClientProfileWithEntitlementCheck,
  normalizeSiteUrl,
  EntitlementLimitError,
  DuplicateWebsiteError,
} from '@/lib/entitlements';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const { url, mode = 'new_company', clientProfileId } = body;
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'A URL is required.' }, { status: 400 });
  }
  if (mode !== 'new_company' && mode !== 'existing_company') {
    return NextResponse.json({ error: 'Invalid mode.' }, { status: 400 });
  }

  const { customer, websites } = await resolveWebsiteForRequest(userId);

  // Command-panel entry accepts any URL, including one the caller already has —
  // reuse the existing row instead of erroring, per the "create or reuse" contract.
  // Matching by host alone (not by company) is correct here: the same real-world
  // site should never be registered twice regardless of which company added it.
  const normalizedHost = normalizeSiteUrl(url);
  const existing = websites.find((w) => w.normalizedHost === normalizedHost);
  if (existing) {
    return NextResponse.json({ id: existing.id, url: existing.url, clientProfileId: existing.clientProfileId, reused: true }, { status: 200 });
  }

  let targetClientProfileId: string;
  if (mode === 'existing_company') {
    // Tenant isolation: the named profile must be one of THIS customer's own --
    // `websites` (from resolveWebsiteForRequest) already spans every company this
    // customer owns, so anything not in there belongs to someone else.
    if (typeof clientProfileId !== 'string' || !websites.some((w) => w.clientProfileId === clientProfileId)) {
      return NextResponse.json({ error: 'That company is not part of your workspace.' }, { status: 400 });
    }
    targetClientProfileId = clientProfileId;
  } else {
    try {
      // Name is the real host, never an invented brand name -- the human can
      // rename the company later; this is a real, honest starting value.
      const created = await createClientProfileWithEntitlementCheck({ customerId: customer.id, name: normalizedHost });
      targetClientProfileId = created.id;
    } catch (err) {
      if (err instanceof EntitlementLimitError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  }

  try {
    const created = await createWebsiteWithEntitlementCheck({
      clientProfileId: targetClientProfileId,
      url,
    });

    // GSC-token inheritance is a same-company convenience, never a cross-company one
    // -- a brand-new site for Company B must never silently reuse Company A's Google
    // identity. A sibling flagged reconnect-required is a known-dead connection --
    // inheriting it would silently recreate the exact "looks connected, isn't" state
    // this fix addresses. Leave the new site unconnected instead; the customer uses
    // the existing Connect flow to link its own Google identity from scratch.
    const companySiblings = websites.filter((w) => w.clientProfileId === targetClientProfileId);
    const siblingWithToken = companySiblings.find((w) => w.gscRefreshToken && !w.gscReconnectRequired);
    const gscInherited = Boolean(siblingWithToken);
    if (siblingWithToken) {
      // Inherits Google auth only — never touches `url`/`normalizedHost`, which stay
      // exactly what the customer typed and are immediately auditable without any
      // property selection.
      await db.website.update({
        where: { id: created.id },
        data: { gscRefreshToken: siblingWithToken.gscRefreshToken },
      });
    }

    return NextResponse.json({ id: created.id, url: created.url, clientProfileId: created.clientProfileId, gscInherited, reused: false }, { status: 201 });
  } catch (err) {
    if (err instanceof EntitlementLimitError || err instanceof DuplicateWebsiteError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
