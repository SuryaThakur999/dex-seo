// v1 platform tags -- exactly the council amendment 2 source list, nothing broader. A connector
// must never claim a platform outside this set; EvidenceItem.platform is typed against it too.
export type ResearchPlatform = 'competitor_site' | 'google_news_rss' | 'trade_press_rss' | 'own_site' | 'youtube';

export interface ResearchCapability {
  channel: ResearchPlatform;
  available: boolean;
  /** Set when unavailable -- e.g. a circuit breaker is open, or (dev-only tooling) a
   * cookie-backed channel that must never report `available: true` in production. */
  unavailableReason?: string;
}

export interface ProviderHealth {
  healthy: boolean;
  checkedAt: Date;
  detail?: string;
}

export interface ResearchQuery {
  query: string;
  windowDays: number;
  /** Narrows a competitor-site search to one entity's known domain(s); absent for a broad
   * Google News / trade-press search. */
  domain?: string;
}

export interface ResearchResult {
  canonicalUrl: string;
  title: string | null;
  publishedAt: Date | null; // null is a real, honest "undated" outcome -- never backfilled with retrievedAt
  excerpt: string;
  sourceType: 'news' | 'blog' | 'press_release' | 'product_page' | 'pricing_page' | 'other';
  platform: ResearchPlatform;
  author?: string | null;
}

export interface ResearchDocumentRequest {
  url: string;
}

export interface ResearchDocument {
  canonicalUrl: string;
  text: string;
  retrievedAt: Date;
  /** Only populated when the source channel actually provides it (e.g. youtube's upload
   * date) -- absent, not backfilled, for channels like web/rss that carry no real date. */
  publishedAt?: Date | null;
  /** Only ever set by the youtube channel. */
  hasCaptions?: boolean;
}

export interface ResearchProvider {
  name: string;
  capabilities(): Promise<ResearchCapability[]>;
  healthCheck(): Promise<ProviderHealth>;
  search(input: ResearchQuery): Promise<ResearchResult[]>;
  read(input: ResearchDocumentRequest): Promise<ResearchDocument>;
}
