'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Mode = 'new_company' | 'existing_company';

// Brand-voice-isolation fix (2026-10-16): the human-approved design asks which company a new
// website belongs to -- "New company" (default) keeps each business's brand voice separate by
// construction, instead of every added site silently inheriting whichever company happened to
// be default first (the bug this fix addresses).
export function AddWebsiteForm({ companies, initialUrl = '' }: { companies: { id: string; name: string }[]; initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
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
      const res = await fetch('/api/websites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'existing_company' ? { url, mode, clientProfileId } : { url, mode }
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not add this website.');
      }
      setUrl('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this website.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 border-t border-border pt-4">
      {companies.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Add a website for:</legend>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="radio" name="addWebsiteMode" value="new_company" checked={mode === 'new_company'} onChange={() => setMode('new_company')} />
            New company
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="radio" name="addWebsiteMode" value="existing_company" checked={mode === 'existing_company'} onChange={() => setMode('existing_company')} />
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
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="newWebsiteUrl" className="text-sm font-medium text-foreground">
          Add a website:
        </label>
        <input
          id="newWebsiteUrl"
          name="url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <Button type="submit" variant="accent" disabled={loading || !url.trim() || (mode === 'existing_company' && !clientProfileId)}>
          {loading ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
