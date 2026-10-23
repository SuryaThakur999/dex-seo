import { LegalPage, legalMetadata, resolveLang } from '@/components/legal/legal-page';
import { IMPRESSUM } from '@/lib/legal/impressum';

export const metadata = legalMetadata('Impressum', '/impressum', { neverIndex: true });

export default function Page({ searchParams }: { searchParams: { lang?: string | string[] } }) {
  return <LegalPage doc={IMPRESSUM} lang={resolveLang(searchParams.lang)} path="/impressum" />;
}
