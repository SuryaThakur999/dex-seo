import { LegalPage, legalMetadata, resolveLang } from '@/components/legal/legal-page';
import { SECURITY } from '@/lib/legal/security';

export const metadata = legalMetadata('Security', '/security');

export default function Page({ searchParams }: { searchParams: { lang?: string | string[] } }) {
  return <LegalPage doc={SECURITY} lang={resolveLang(searchParams.lang)} path="/security" />;
}
