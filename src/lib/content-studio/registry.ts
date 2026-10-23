import type { ContentPlatform } from '@prisma/client';
import type { PlatformAdapter } from './adapter-types';
import { linkedinAdapter } from './adapters/linkedin';
import { xAdapter } from './adapters/x';
import { facebookAdapter } from './adapters/facebook';
import { instagramAdapter } from './adapters/instagram';
import { redditAdapter } from './adapters/reddit';
import { tiktokAdapter } from './adapters/tiktok';
import { youtubeAdapter } from './adapters/youtube';
import { ugcBriefAdapter } from './adapters/ugc-brief';

const REGISTRY: Record<ContentPlatform, PlatformAdapter<unknown>> = {
  linkedin: linkedinAdapter as PlatformAdapter<unknown>,
  x: xAdapter as PlatformAdapter<unknown>,
  facebook: facebookAdapter as PlatformAdapter<unknown>,
  instagram: instagramAdapter as PlatformAdapter<unknown>,
  reddit: redditAdapter as PlatformAdapter<unknown>,
  tiktok: tiktokAdapter as PlatformAdapter<unknown>,
  youtube: youtubeAdapter as PlatformAdapter<unknown>,
  ugc_brief: ugcBriefAdapter as PlatformAdapter<unknown>,
};

/**
 * Single source of truth for the platform list at runtime. Derived from
 * REGISTRY, which is a `Record<ContentPlatform, …>`, so the compiler already
 * forces it to stay in lockstep with the Prisma enum — anything that needs to
 * validate or enumerate platforms imports this instead of re-typing the eight
 * names.
 */
export const ALL_PLATFORMS = Object.keys(REGISTRY) as ContentPlatform[];

export function getAdapter(platform: ContentPlatform): PlatformAdapter<unknown> {
  return REGISTRY[platform];
}

export function listAdapters(): PlatformAdapter<unknown>[] {
  return Object.values(REGISTRY);
}
