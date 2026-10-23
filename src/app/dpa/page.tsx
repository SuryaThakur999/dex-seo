import { LegalPage, legalMetadata, resolveLang } from '@/components/legal/legal-page';
import { DPA } from '@/lib/legal/dpa';

export const metadata = legalMetadata('Data processing agreement', '/dpa');

export default function Page({ searchParams }: { searchParams: { lang?: string | string[] } }) {
  return <LegalPage doc={DPA} lang={resolveLang(searchParams.lang)} path="/dpa" />;
}
