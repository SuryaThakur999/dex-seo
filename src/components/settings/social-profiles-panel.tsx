'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type SocialPlatform = 'linkedin' | 'xing' | 'instagram' | 'facebook' | 'x' | 'youtube' | 'tiktok';

export interface SocialProfileItem {
  platform: SocialPlatform;
  url: string;
}

const PLATFORM_OPTIONS: { value: SocialPlatform; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'xing', label: 'Xing' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'x', label: 'X' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
];

const PLATFORM_LABEL: Record<SocialPlatform, string> = Object.fromEntries(
  PLATFORM_OPTIONS.map((o) => [o.value, o.label]),
) as Record<SocialPlatform, string>;

export function SocialProfilesPanel({
  clientProfileId, profiles: initialProfiles,
}: {
  clientProfileId: string;
  profiles: SocialProfileItem[];
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [platform, setPlatform] = useState<SocialPlatform>('linkedin');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: SocialProfileItem[]) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/client-profile/${clientProfileId}/social-profiles`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socialProfiles: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong -- try again.');
        return;
      }
      setProfiles(next);
    } catch {
      setError('Something went wrong -- try again.');
    } finally {
      setPending(false);
    }
  }

  function handleRemove(target: SocialProfileItem) {
    save(profiles.filter((p) => !(p.platform === target.platform && p.url === target.url)));
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || pending) return;
    save([...profiles, { platform, url: url.trim() }]);
    setUrl('');
  }

  return (
    <Card className="mt-6" role="region" aria-label="Your channels">
      <CardHeader>
        <CardTitle><h2>Your channels</h2></CardTitle>
        <CardDescription>
          Social profiles Dex found on your site, or that you added yourself. Add or remove any of them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="socialPlatform" className="text-sm font-medium text-foreground">Platform</label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as SocialPlatform)}>
              <SelectTrigger id="socialPlatform" className="h-11 w-36 sm:h-9" aria-label="Platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="socialChannelUrl" className="text-sm font-medium text-foreground">Channel URL</label>
            <input
              id="socialChannelUrl" name="url" type="url" required value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://linkedin.com/company/acme"
              className="min-w-[240px] rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <Button type="submit" variant="accent" disabled={pending || !url.trim()}>Add a channel</Button>
        </form>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {profiles.length > 0 && (
          <ul aria-label="Your channels" className="flex flex-col gap-3">
            {profiles.map((p) => (
              <li key={`${p.platform}:${p.url}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">{PLATFORM_LABEL[p.platform]}</span>
                  <span className="min-w-0 break-all text-xs text-muted-foreground">{p.url}</span>
                </div>
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => handleRemove(p)}>
                  {`Remove ${PLATFORM_LABEL[p.platform]}`}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
