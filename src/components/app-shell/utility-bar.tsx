import { UserButton } from '@clerk/nextjs';
import { CloudCheck, CloudSlash } from '@phosphor-icons/react/dist/ssr';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/lib/dashboard-stats';
import { SiteSwitcher } from './site-switcher';

export function UtilityBar({
  websiteUrl,
  gscConnected,
  lastRefresh,
  websites,
  currentWebsiteId,
  profileName,
  switcherHrefPattern,
  showAddWebsite = false,
  companies = [],
}: {
  websiteUrl: string;
  gscConnected: boolean;
  lastRefresh: Date | null;
  websites?: { id: string; url: string }[];
  currentWebsiteId?: string;
  profileName?: string;
  switcherHrefPattern?: string;
  showAddWebsite?: boolean;
  /** Passed straight through to SiteSwitcher -> WebsiteEntryPanel (overseer polish item 4, 2026-10-16). */
  companies?: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {websites && currentWebsiteId && (websites.length > 1 || showAddWebsite) ? (
          <SiteSwitcher
            websites={websites}
            currentWebsiteId={currentWebsiteId}
            profileName={profileName}
            hrefPattern={switcherHrefPattern}
            showAddWebsite={showAddWebsite}
            gscConnected={gscConnected}
            companies={companies}
          />
        ) : (
          <span className="truncate font-mono text-sm font-medium text-foreground">{websiteUrl}</span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--dex-app-border-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {gscConnected ? (
                <CloudCheck size={12} weight="bold" className="text-[var(--dex-app-success)]" aria-hidden="true" />
              ) : (
                <CloudSlash size={12} weight="bold" className="text-[var(--dex-app-danger)]" aria-hidden="true" />
              )}
              {gscConnected ? 'Search Console connected' : 'Search Console not connected'}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {gscConnected ? 'Search Console connected' : 'Search Console not connected'}
          </TooltipContent>
        </Tooltip>
      </div>
      <UserButton afterSignOutUrl="/" />
    </div>
  );
}
