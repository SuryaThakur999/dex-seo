import { AppShellNav } from '@/components/app-shell/app-shell-nav';
import { AppFooter } from '@/components/app-shell/app-footer';

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="dex-app-root" className="dex-app flex min-h-screen bg-background text-foreground">
      <AppShellNav />
      <div className="flex min-w-0 flex-1 flex-col pb-16 sm:pb-0">
        <div className="flex-1">{children}</div>
        <AppFooter />
      </div>
    </div>
  );
}
