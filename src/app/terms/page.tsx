import { LegalPage, legalMetadata, resolveLang } from '@/components/legal/legal-page';
import { TERMS } from '@/lib/legal/terms';

export const metadata = legalMetadata('Terms of use', '/terms');

export default function Page({ searchParams }: { searchParams: { lang?: string | string[] } }) {
  return <LegalPage doc={TERMS} lang={resolveLang(searchParams.lang)} path="/terms" />;
}
