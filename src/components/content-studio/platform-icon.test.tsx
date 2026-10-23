import { describe, it, expect } from 'vitest';
import { SiFacebook, SiInstagram, SiReddit, SiTiktok, SiX, SiYoutube } from 'react-icons/si';
import { LinkedinLogo, UsersThree } from '@phosphor-icons/react/dist/ssr';
import { PlatformIcon, PLATFORM_LABELS } from './platform-icon';
import type { ContentPlatform } from '@prisma/client';

const REAL_PLATFORM_COMPONENTS: Record<Exclude<ContentPlatform, 'ugc_brief'>, unknown> = {
  linkedin: LinkedinLogo,
  x: SiX,
  facebook: SiFacebook,
  instagram: SiInstagram,
  reddit: SiReddit,
  tiktok: SiTiktok,
  youtube: SiYoutube,
};

describe('PlatformIcon', () => {
  it('renders the matching brand icon component for each of the 7 real platforms', () => {
    for (const platform of Object.keys(REAL_PLATFORM_COMPONENTS) as (keyof typeof REAL_PLATFORM_COMPONENTS)[]) {
      const el = PlatformIcon({ platform: platform as ContentPlatform });
      expect(el.type).toBe(REAL_PLATFORM_COMPONENTS[platform]);
    }
  });

  it('renders the neutral UsersThree glyph for ugc_brief', () => {
    const el = PlatformIcon({ platform: 'ugc_brief' });
    expect(el.type).toBe(UsersThree);
    expect(el.props.className).toBe('text-muted-foreground');
  });

  it('icon-only mode (default) sets role=img and aria-label to the platform label', () => {
    const el = PlatformIcon({ platform: 'x' });
    expect(el.props.role).toBe('img');
    expect(el.props['aria-label']).toBe('X');
  });

  it('icon-only mode does not mark the glyph aria-hidden', () => {
    const el = PlatformIcon({ platform: 'youtube' });
    expect(el.props['aria-hidden']).toBeUndefined();
  });

  it('labeled mode wraps a decorative (aria-hidden) icon and the visible label text', () => {
    const el = PlatformIcon({ platform: 'reddit', labeled: true });
    expect(el.type).toBe('span');
    const children = el.props.children as [
      { type: unknown; props: Record<string, unknown> },
      { props: { children: string } }
    ];
    const [glyph, label] = children;
    expect(glyph.type).toBe(SiReddit);
    expect(glyph.props['aria-hidden']).toBe(true);
    expect(glyph.props.role).toBeUndefined();
    expect(label.props.children).toBe('Reddit');
  });

  it('passes the requested size through to the glyph', () => {
    const el = PlatformIcon({ platform: 'tiktok', size: 32 });
    expect(el.props.size).toBe(32);
  });

  it('exposes PLATFORM_LABELS for all 8 platforms', () => {
    expect(PLATFORM_LABELS).toEqual({
      linkedin: 'LinkedIn',
      instagram: 'Instagram',
      facebook: 'Facebook',
      x: 'X',
      reddit: 'Reddit',
      tiktok: 'TikTok',
      youtube: 'YouTube',
      ugc_brief: 'UGC Brief',
    });
  });
});
