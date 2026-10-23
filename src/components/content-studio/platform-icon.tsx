import React from 'react';
import { SiFacebook, SiInstagram, SiReddit, SiTiktok, SiX, SiYoutube } from 'react-icons/si';
import { LinkedinLogo, UsersThree } from '@phosphor-icons/react/dist/ssr';
import type { ContentPlatform } from '@prisma/client';

export const PLATFORM_LABELS: Record<ContentPlatform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  reddit: 'Reddit',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  ugc_brief: 'UGC Brief',
};

// react-icons/si ships Simple Icons' SVG paths only — no brand hex is exposed
// at runtime on any Si* export (checked directly: react-icons 5.7.0's
// generated icon files carry `role`/`viewBox`/path `d` and nothing else).
// Simple Icons has also dropped LinkedIn's mark from its set entirely (no
// SiLinkedin export in this package version), so linkedin falls back to
// Phosphor's LinkedinLogo below. Hex values are each brand's own published
// mark color, not read off any icon library.
const PLATFORM_COLORS: Record<Exclude<ContentPlatform, 'ugc_brief'>, string> = {
  linkedin: '#0A66C2',
  x: '#000000',
  facebook: '#1877F2',
  instagram: '#E4405F',
  reddit: '#FF4500',
  tiktok: '#000000',
  youtube: '#FF0000',
};

function renderGlyph(platform: ContentPlatform, size: number, decorative: boolean) {
  // Icon-only usage carries its own aria-label/role; alongside visible text
  // (labeled mode) the glyph is decorative so screen readers don't announce
  // the platform name twice.
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': PLATFORM_LABELS[platform] };

  switch (platform) {
    case 'linkedin':
      return <LinkedinLogo size={size} color={PLATFORM_COLORS.linkedin} weight="fill" {...a11yProps} />;
    case 'x':
      return <SiX size={size} color={PLATFORM_COLORS.x} {...a11yProps} />;
    case 'facebook':
      return <SiFacebook size={size} color={PLATFORM_COLORS.facebook} {...a11yProps} />;
    case 'instagram':
      return <SiInstagram size={size} color={PLATFORM_COLORS.instagram} {...a11yProps} />;
    case 'reddit':
      return <SiReddit size={size} color={PLATFORM_COLORS.reddit} {...a11yProps} />;
    case 'tiktok':
      return <SiTiktok size={size} color={PLATFORM_COLORS.tiktok} {...a11yProps} />;
    case 'youtube':
      return <SiYoutube size={size} color={PLATFORM_COLORS.youtube} {...a11yProps} />;
    case 'ugc_brief':
      return <UsersThree size={size} className="text-muted-foreground" {...a11yProps} />;
  }
}

export function PlatformIcon({
  platform,
  size = 20,
  labeled = false,
}: {
  platform: ContentPlatform;
  size?: number;
  labeled?: boolean;
}) {
  if (!labeled) return renderGlyph(platform, size, false);
  return (
    <span className="inline-flex items-center gap-1.5">
      {renderGlyph(platform, size, true)}
      <span>{PLATFORM_LABELS[platform]}</span>
    </span>
  );
}
