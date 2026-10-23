import './globals.css';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/app-shell/theme-provider';
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from '@/lib/site-seo';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: '%s | Dex' },
  description: SITE_DESCRIPTION,
  openGraph: { type: 'website', siteName: 'Dex', title: SITE_TITLE, description: SITE_DESCRIPTION, url: SITE_URL },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <ThemeProvider>{children}</ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
