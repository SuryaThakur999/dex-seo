import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { resolveWebsiteForRequest } from '@/lib/customer';

export default async function DashboardRedirectPage() {
  const { userId } = auth();
  if (!userId) return null; // middleware already redirects unauthenticated users

  const { website } = await resolveWebsiteForRequest(userId);
  redirect(`/dashboard/${website.id}`);
}
