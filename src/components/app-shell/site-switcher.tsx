'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { WebsiteEntryPanel } from '@/components/dashboard/website-entry-panel';

export function SiteSwitcher({
  websites,
  currentWebsiteId,
  profileName,
  hrefPattern = '/dashboard/{id}',
  showAddWebsite = false,
  gscConnected = false,
  companies = [],
}: {
  /** `profileName` here is this ONE website's own company name -- falls back to the global
   *  `profileName` prop below when absent (single-company accounts never need to set it). */
  websites: { id: string; url: string; profileName?: string }[];
  currentWebsiteId: string;
  profileName?: string;
  /** Destination for a picked site; `{id}` is replaced with the website id. */
  hrefPattern?: string;
  /** Dashboard IA rebuild (2026-10-16 spec): only the dashboard header instance sets this --
   *  Studio's and Settings' own SiteSwitcher calls omit it and keep today's behavior. */
  showAddWebsite?: boolean;
  gscConnected?: boolean;
  /** Passed straight through to WebsiteEntryPanel (overseer polish item 4, 2026-10-16). */
  companies?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const currentWebsite = websites.find((site) => site.id === currentWebsiteId);
  const currentLabel = currentWebsite?.profileName ?? profileName;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={currentWebsiteId}
          onValueChange={(id) => router.push(hrefPattern.replace('{id}', encodeURIComponent(id)))}
        >
          <SelectTrigger
            aria-label="Switch website"
            className="min-w-0 max-w-[160px] border-[var(--dex-app-border-strong)] text-left shadow-none data-[size=default]:h-11 sm:max-w-[260px]"
          >
            <SelectValue className="min-w-0">
              <span className="block min-w-0">
                {currentLabel && <span className="block truncate text-xs font-medium">{currentLabel}</span>}
                <span className="block truncate font-mono text-xs text-muted-foreground">{currentWebsite?.url}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="max-w-[calc(100vw-2rem)]">
            {websites.map((site) => {
              const label = site.profileName ?? profileName;
              return (
                <SelectItem key={site.id} value={site.id} textValue={`${label ?? ''} ${site.url}`} className="min-h-11 [&>span:last-child]:min-w-0">
                  <span className="block min-w-0">
                    {label && <span className="block truncate text-xs font-medium">{label}</span>}
                    <span className="block truncate font-mono text-xs text-muted-foreground">{site.url}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {showAddWebsite && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen((v) => !v)}>
            {addOpen ? 'Cancel' : 'Add website'}
          </Button>
        )}
      </div>
      {showAddWebsite && addOpen && (
        <WebsiteEntryPanel currentWebsiteId={currentWebsiteId} gscConnected={gscConnected} companies={companies} />
      )}
    </div>
  );
}
