import type { Metadata } from 'next';
import { SignUp } from '@clerk/nextjs';
import { signupRedirect } from '@/lib/signup-site';

export const metadata: Metadata = { title: 'Sign up', robots: { index: false, follow: false } };

export default function SignUpPage({
  searchParams,
}: {
  searchParams: { site?: string | string[] };
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <SignUp forceRedirectUrl={signupRedirect(searchParams.site)} />
      {/* Contract conclusion: creating the account accepts the terms (AGB § 3). */}
      <p className="max-w-sm px-4 text-center text-[0.8125rem] leading-relaxed text-[#9a9aa5]">
        By creating an account you agree to our{' '}
        <a href="/terms" className="underline underline-offset-2 hover:text-white">terms</a> and confirm you have read our{' '}
        <a href="/privacy" className="underline underline-offset-2 hover:text-white">privacy policy</a>. Mit dem Anlegen eines Kontos
        stimmen Sie unseren <a href="/terms?lang=de" className="underline underline-offset-2 hover:text-white">AGB</a> zu und
        bestätigen, die <a href="/privacy?lang=de" className="underline underline-offset-2 hover:text-white">Datenschutzerklärung</a>{' '}
        gelesen zu haben.
      </p>
    </div>
  );
}
