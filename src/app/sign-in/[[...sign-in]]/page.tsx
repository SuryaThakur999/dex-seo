import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default function SignInPage() {
  return <SignIn forceRedirectUrl="/dashboard" />;
}
