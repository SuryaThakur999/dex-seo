// Studio paste-link fails for these 5 platforms -- unauthenticated reads either return a non-
// standard block status (overseer confirmed HTTP 999 on LinkedIn in prod) or redirect to a
// login wall. Checked BEFORE calling safeFetch/AgentReachProvider, not after a failed fetch --
// we don't rely on any particular block status code, we know these hosts up front.
const BLOCKED_HOST_LABEL: Record<string, string> = {
  'linkedin.com': 'LinkedIn', 'www.linkedin.com': 'LinkedIn',
  'instagram.com': 'Instagram', 'www.instagram.com': 'Instagram',
  'facebook.com': 'Facebook', 'www.facebook.com': 'Facebook',
  'x.com': 'X', 'www.x.com': 'X', 'twitter.com': 'X', 'www.twitter.com': 'X',
  'tiktok.com': 'TikTok', 'www.tiktok.com': 'TikTok',
};

export function detectBlockedSocialHost(url: string): { label: string } | null {
  try {
    const hostname = new URL(url).hostname;
    const label = BLOCKED_HOST_LABEL[hostname];
    return label ? { label } : null;
  } catch {
    return null;
  }
}
