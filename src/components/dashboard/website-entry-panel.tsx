'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ThinkingOrb } from 'thinking-orbs';

type Mode = 'new_company' | 'existing_company';

export function WebsiteEntryPanel({
  currentWebsiteId,
  gscConnected,
  companies = [],
}: {
  currentWebsiteId: string;
  gscConnected: boolean;
  /** Dashboard "Add website" polish (overseer item 4, 2026-10-16): same new-vs-existing-company
   *  choice Settings' AddWebsiteForm already has -- without it this panel always created a new
   *  company (API default), with no way to add another site to a company the customer already has. */
  companies?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<Mode>('new_company');
  const [clientProfileId, setClientProfileId] = useState(companies[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const websiteRes = await fetch('/api/websites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'existing_company' ? { url, mode, clientProfileId } : { url, mode }
        ),
      });
      const websiteBody = await websiteRes.json().catch(() => ({}));
      if (!websiteRes.ok) {
        throw new Error(websiteBody.error ?? 'Could not audit this website.');
      }

      const targetId = websiteBody.id as string;
      const scanForm = new FormData();
      scanForm.set('websiteId', targetId);
      await fetch('/api/scan', { method: 'POST', body: scanForm });

      setUrl('');
      if (targetId !== currentWebsiteId) {
        router.push(`/dashboard/${targetId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not audit this website.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        <p className="text-sm font-medium text-foreground">What website should Dex check?</p>
        {companies.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground">Add a website for:</legend>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="radio" name="dashboardAddWebsiteMode" value="new_company" checked={mode === 'new_company'} onChange={() => setMode('new_company')} />
              New company
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="radio" name="dashboardAddWebsiteMode" value="existing_company" checked={mode === 'existing_company'} onChange={() => setMode('existing_company')} />
              Another site of an existing company
            </label>
            {mode === 'existing_company' && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Company
                <select
                  value={clientProfileId}
                  onChange={(e) => setClientProfileId(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        )}
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            aria-label="Website URL"
            className="h-11 min-w-[240px] flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" variant="accent" disabled={loading || !url.trim() || (mode === 'existing_company' && !clientProfileId)} className="h-11">
            {loading ? <><ThinkingOrb state="searching" size={20} theme="dark" aria-hidden="true" className="mr-2" />Running…</> : 'Run audit'}
          </Button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Audit public pages. No Google connection required.</span>
          {!gscConnected && (
            <a
              href={`/api/gsc/connect?websiteId=${currentWebsiteId}`}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Connect Search Console — add search performance
            </a>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
