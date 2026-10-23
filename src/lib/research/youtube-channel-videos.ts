import { safeFetch } from '@/lib/safe-fetch';
import { callAgentReachVideoList, type AgentReachVideoListItem } from './providers/agent-reach-client';

export type RecentVideo = AgentReachVideoListItem;

// Lists a channel's recent uploads via Agent Reach's 'youtube' channel in list mode.
// Same pre-check discipline as every other externally supplied URL this phase: the
// channel URL is validated against safeFetch's allowlist/SSRF rules in Node before it
// ever reaches Agent Reach -- same pattern as CompetitorSiteProvider's domain check.
export async function listRecentVideos(channelUrl: string): Promise<RecentVideo[]> {
  await safeFetch(channelUrl);
  return callAgentReachVideoList(channelUrl);
}
