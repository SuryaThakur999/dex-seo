import { LegalPage, legalMetadata, resolveLang } from '@/components/legal/legal-page';
import { PRIVACY } from '@/lib/legal/privacy';

export const metadata = legalMetadata('Privacy policy', '/privacy');

export default function Page({ searchParams }: { searchParams: { lang?: string | string[] } }) {
  return <LegalPage doc={PRIVACY} lang={resolveLang(searchParams.lang)} path="/privacy" />;
}
