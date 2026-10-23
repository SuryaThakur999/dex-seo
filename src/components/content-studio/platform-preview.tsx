import React from 'react';
import type { ContentPlatform } from '@prisma/client';
import { PlatformIcon, PLATFORM_LABELS } from './platform-icon';
import type { LinkedInDraft } from '@/lib/content-studio/adapters/linkedin';
import type { XDraft } from '@/lib/content-studio/adapters/x';
import type { FacebookDraft } from '@/lib/content-studio/adapters/facebook';
import type { InstagramDraft } from '@/lib/content-studio/adapters/instagram';
import type { RedditDraft } from '@/lib/content-studio/adapters/reddit';
import type { TikTokDraft } from '@/lib/content-studio/adapters/tiktok';
import type { YouTubeDraft } from '@/lib/content-studio/adapters/youtube';
import type { UgcBriefDraft } from '@/lib/content-studio/adapters/ugc-brief';

function Hashtags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <p className="text-sm text-accent">
      {tags.map((t) => `#${t.replace(/^#/, '')}`).join(' ')}
    </p>
  );
}

function ChipList({ items, prefix = '' }: { items: string[]; prefix?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {prefix}
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * Platform-faithful preview: real drafted text laid out to resemble that platform's post shape
 * (body copy, hashtags, subreddit chips, script beats), without invented images, avatar photos,
 * or engagement counts. `draft` is `Json` at the DB layer; each branch narrows it to the adapter's
 * own real interface rather than reaching for a generic shape.
 */
export function PlatformPreview({ platform, draft }: { platform: ContentPlatform; draft: unknown }) {
  switch (platform) {
    case 'linkedin':
    case 'facebook': {
      const d = draft as LinkedInDraft | FacebookDraft;
      return (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap text-sm text-foreground">{d.body}</p>
          <Hashtags tags={d.hashtags} />
        </div>
      );
    }
    case 'x': {
      const d = draft as XDraft;
      const posts = d.posts ?? [d.body];
      const tags = d.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ');
      return (
        <ol className="flex list-none flex-col gap-4" aria-label="X posts">
          {posts.map((post, index) => {
            const isLast = index === posts.length - 1;
            const length = post.length + (isLast && tags ? tags.length + 2 : 0);
            return (
              <li key={index} className="flex min-w-0 flex-col gap-2">
                {posts.length > 1 && (
                  <p className="text-xs text-muted-foreground">Post {index + 1} of {posts.length}</p>
                )}
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{post}</p>
                {isLast && <Hashtags tags={d.hashtags} />}
                <p className="text-xs text-muted-foreground">{length}/280 characters</p>
              </li>
            );
          })}
        </ol>
      );
    }
    case 'instagram': {
      const d = draft as InstagramDraft;
      return (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap text-sm text-foreground">{d.caption}</p>
          <Hashtags tags={d.hashtags} />
          <p className="text-xs text-muted-foreground">Alt text: {d.altText || '(none provided)'}</p>
        </div>
      );
    }
    case 'reddit': {
      const d = draft as RedditDraft;
      return (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold text-foreground">{d.title}</h4>
          <p className="whitespace-pre-wrap text-sm text-foreground">{d.body}</p>
          <ChipList items={d.suggestedSubreddits} prefix="r/" />
        </div>
      );
    }
    case 'tiktok': {
      const d = draft as TikTokDraft;
      return (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Hook</p>
          <p className="text-sm font-medium text-foreground">{d.hook}</p>
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Script</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{d.script}</p>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{d.captionText}</p>
          <Hashtags tags={d.hashtags} />
        </div>
      );
    }
    case 'youtube': {
      const d = draft as YouTubeDraft;
      return (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-semibold text-foreground">{d.title}</h4>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{d.description}</p>
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Script</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{d.script}</p>
        </div>
      );
    }
    case 'ugc_brief': {
      const d = draft as UgcBriefDraft;
      return (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap text-sm text-foreground">{d.brief}</p>
          {d.deliverables.length > 0 && (
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Deliverables</p>
              <ul className="list-disc pl-4 text-sm text-foreground">
                {d.deliverables.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {d.doNotSay.length > 0 && (
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Do not say</p>
              <ul className="list-disc pl-4 text-sm text-destructive">
                {d.doNotSay.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
  }
}

export function PlatformPreviewHeader({ platform }: { platform: ContentPlatform }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
      <PlatformIcon platform={platform} size={16} />
      {PLATFORM_LABELS[platform]} preview
    </div>
  );
}
