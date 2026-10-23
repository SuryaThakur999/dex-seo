import { describe, expect, it } from 'vitest';
import { detectBlockedSocialHost } from './social-host-block';

describe('detectBlockedSocialHost (social-profile-discovery plan, 2026-10-17)', () => {
  it('detects linkedin.com', () => {
    expect(detectBlockedSocialHost('https://www.linkedin.com/posts/acme_123')).toEqual({ label: 'LinkedIn' });
  });

  it('detects instagram.com, facebook.com, x.com, twitter.com, and tiktok.com', () => {
    expect(detectBlockedSocialHost('https://www.instagram.com/acme')).toEqual({ label: 'Instagram' });
    expect(detectBlockedSocialHost('https://www.facebook.com/acme')).toEqual({ label: 'Facebook' });
    expect(detectBlockedSocialHost('https://x.com/acme')).toEqual({ label: 'X' });
    expect(detectBlockedSocialHost('https://twitter.com/acme')).toEqual({ label: 'X' });
    expect(detectBlockedSocialHost('https://www.tiktok.com/@acme')).toEqual({ label: 'TikTok' });
  });

  it('returns null for a readable host (overseer-confirmed working control)', () => {
    expect(detectBlockedSocialHost('https://ihk.de/some-article')).toBeNull();
    expect(detectBlockedSocialHost('https://en.wikipedia.org/wiki/Acme')).toBeNull();
  });

  it('returns null for an unparseable URL instead of throwing', () => {
    expect(detectBlockedSocialHost('not a url')).toBeNull();
  });
});
