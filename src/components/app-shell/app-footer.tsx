import { ThemeToggle } from '@/components/app-shell/theme-toggle';

export function AppFooter() {
  return (
    <footer className="dex-glass mt-auto border-t border-border">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-4 sm:px-8">
        <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Dex</p>
        <ThemeToggle />
      </div>
    </footer>
  );
}
