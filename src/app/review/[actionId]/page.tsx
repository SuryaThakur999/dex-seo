import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { ActionDetail } from '@/components/review/action-detail';
import { actionRevision } from '@/lib/proof-receipt';
import { loadProofReceipt } from '@/lib/load-proof-receipt';

export default async function ActionDetailPage({ params, searchParams = {} }: {
  params: { actionId: string };
  searchParams?: { clientProfileId?: string | string[]; websiteId?: string | string[]; type?: string | string[] };
}) {
  const { userId } = auth();
  if (!userId) return null;

  const customer = await db.customer.findUnique({ where: { clerkUserId: userId } });
  if (!customer) return null;

  const action = await db.action.findUnique({
    where: { id: params.actionId },
    include: { guardResult: true, website: { include: { clientProfile: { select: { id: true, customerId: true } } } } },
  });

  if (!action || action.customerId !== customer.id ||
      action.websiteId !== action.website.id ||
      action.website.clientProfileId !== action.website.clientProfile.id ||
      action.website.clientProfile.customerId !== customer.id) notFound();

  const receipt = await loadProofReceipt(action, customer.id);
  const queueParams = new URLSearchParams();
  for (const key of ['clientProfileId', 'websiteId', 'type'] as const) {
    const value = searchParams[key];
    if (typeof value === 'string' && value) queueParams.set(key, value);
  }
  const queueHref = '/review' + (queueParams.size ? '?' + queueParams : '');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={queueHref} className="mb-4 inline-flex min-h-11 items-center rounded-md text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Back to review queue</Link>
      <ActionDetail action={action} revision={actionRevision(action)} receipt={receipt} />
    </main>
  );
}
