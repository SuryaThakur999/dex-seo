import { LegalPage, legalMetadata, resolveLang } from '@/components/legal/legal-page';
import { COOKIES } from '@/lib/legal/cookies';

export const metadata = legalMetadata('Cookies', '/cookies');

export default function Page({ searchParams }: { searchParams: { lang?: string | string[] } }) {
  return <LegalPage doc={COOKIES} lang={resolveLang(searchParams.lang)} path="/cookies" />;
}
