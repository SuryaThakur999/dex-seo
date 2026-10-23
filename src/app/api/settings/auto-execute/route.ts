import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildAuditLogEntryArgs } from '@/lib/audit-log';
import { resolveWebsiteForRequest, WebsiteNotFoundError } from '@/lib/customer';

export async function POST(req: NextRequest) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const body = await req.json();
  const enabled = Boolean(body.enabled);
  const websiteId = typeof body.websiteId === 'string' ? body.websiteId : undefined;

  let customer, website;
  try {
    ({ customer, website } = await resolveWebsiteForRequest(userId, websiteId));
  } catch (err) {
    if (err instanceof WebsiteNotFoundError) {
      return NextResponse.json({ error: 'Website not found' }, { status: 404 });
    }
    throw err;
  }

  await db.$transaction([
    db.website.update({ where: { id: website.id }, data: { autoExecuteEnabled: enabled } }),
    db.auditLogEntry.create(buildAuditLogEntryArgs(customer.id, 'auto_execute_toggled', { enabled, websiteId: website.id, at: new Date().toISOString() })),
  ]);

  return NextResponse.json({ ok: true });
}
