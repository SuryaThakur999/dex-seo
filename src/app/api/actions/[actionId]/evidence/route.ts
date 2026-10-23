import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { renderEvidencePdf } from '@/lib/evidence-pdf';
import { loadProofReceipt } from '@/lib/load-proof-receipt';

export async function GET(req: NextRequest, { params }: { params: { actionId: string } }) {
  const { userId } = auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return new Response('Not found', { status: 404 });

  const action = await db.action.findUnique({
    where: { id: params.actionId },
    include: { guardResult: true, website: { include: { clientProfile: { select: { id: true, customerId: true } } } } },
  });
  if (!action || action.customerId !== customer.id ||
      action.websiteId !== action.website.id ||
      action.website.clientProfileId !== action.website.clientProfile.id ||
      action.website.clientProfile.customerId !== customer.id) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 });
  }
  if (action.status !== 'approved' && action.status !== 'edited') {
    return NextResponse.json({ error: 'No evidence pack for an undecided or rejected action' }, { status: 400 });
  }

  const receipt = await loadProofReceipt(action, customer.id);
  const pdfBuffer = await renderEvidencePdf({
    receipt,
    status: action.status,
    decidedAt: action.decidedAt!,
  });

  // Node's Buffer doesn't satisfy the DOM `BodyInit` union that Next's Response is typed against,
  // so hand it the plain Uint8Array view of the same bytes.
  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="dex-evidence-${action.id}.pdf"`,
    },
  });
}
