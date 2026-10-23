'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { detectBlockedSocialHost } from '@/lib/social-host-block';

export interface PickedEvidence {
  id: string;
  canonicalUrl: string;
  excerpt: string;
}

interface RecentVideoView {
  id: string;
  title: string | null;
  publishedAt: string | null;
}

type Mode = 'url' | 'video';

// Task 24: lets the Studio owner ground a draft in a pasted article (Task 22) or a chosen
// video's captions (Task 23), without needing Dex to have crawled it first. No persisted
// channel -- the owner re-enters a channel URL each time they want to list its videos; storing
// one would need a new ClientProfile column, which this task was not authorized to add.
export function EvidenceSourcePicker({ websiteId, onEvidenceLoaded }: { websiteId?: string; onEvidenceLoaded: (evidence: PickedEvidence) => void }) {
  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [channelUrl, setChannelUrl] = useState('');
  const [videos, setVideos] = useState<RecentVideoView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checked as the owner types, not after a failed request -- Studio already knows these 5
  // hosts never work unauthenticated (social-host-block.ts), no need to round-trip first.
  const blockedHost = detectBlockedSocialHost(url.trim());

  async function handleUseText() {
    if (!pastedText.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content-studio/evidence-from-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId, url: url.trim(), text: pastedText.trim() }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error ?? 'Could not save that text.');
      onEvidenceLoaded(responseBody.evidence as PickedEvidence);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that text.');
    } finally {
      setLoading(false);
    }
  }

  async function loadEvidence(path: string, extra: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId, ...extra }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error ?? 'Could not load that source.');
      onEvidenceLoaded(responseBody.evidence as PickedEvidence);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that source.');
    } finally {
      setLoading(false);
    }
  }

  async function handleListVideos() {
    if (!channelUrl.trim() || loading) return;
    setLoading(true);
    setError(null);
    setVideos(null);
    try {
      const res = await fetch('/api/content-studio/evidence-from-video-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteId, channelUrl: channelUrl.trim() }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error ?? 'Could not load that channel.');
      setVideos(responseBody.videos as RecentVideoView[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that channel.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="url">Paste a link</TabsTrigger>
          <TabsTrigger value="video">Pick a video</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === 'url' && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Article or page URL
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim()) void loadEvidence('/api/content-studio/evidence-from-url', { url: url.trim() });
              }}
              placeholder="https://…"
              className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>
          {blockedHost ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {`${blockedHost.label} only shows this page to logged-in users, so Dex cannot read it. Paste the post text instead.`}
              </p>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Paste the post text
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  rows={4}
                  className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </label>
              <Button type="button" size="sm" variant="outline" disabled={loading || !pastedText.trim()} onClick={() => void handleUseText()}>
                {loading ? 'Saving…' : 'Use this text'}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || !url.trim()}
              onClick={() => void loadEvidence('/api/content-studio/evidence-from-url', { url: url.trim() })}
            >
              {loading ? 'Loading…' : 'Load evidence'}
            </Button>
          )}
        </div>
      )}

      {mode === 'video' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Channel URL
              <input
                type="text"
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleListVideos();
                }}
                placeholder="https://www.youtube.com/@channel/videos"
                className="h-9 rounded-md border border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </label>
            <Button type="button" size="sm" variant="outline" disabled={loading || !channelUrl.trim()} onClick={() => void handleListVideos()}>
              {loading ? 'Loading…' : 'List videos'}
            </Button>
          </div>
          {videos && videos.length === 0 && <p className="text-xs text-muted-foreground">No recent videos found for that channel.</p>}
          {videos && videos.length > 0 && (
            <ul className="flex flex-col gap-2">
              {videos.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-foreground">{v.title ?? v.id}</span>
                  <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void loadEvidence('/api/content-studio/evidence-from-video', { videoId: v.id })}>
                    Use this video
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
