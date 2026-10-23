import { AgentReachProvider } from './agent-reach-provider';

// Thin named wrapper around AgentReachProvider's youtube channel -- a genuine Agent Reach
// value-add (yt-dlp), unlike plain RSS. No sourceType specific to video exists in the v1 enum
// (EvidenceItem.sourceType is a fixed enum per the schema), so results are tagged 'other'.
export class YouTubeProvider extends AgentReachProvider {
  constructor() {
    super('youtube', 'youtube');
  }
}
