// Thin HTTP client for the pinned Agent Reach v1.5.0 Vercel Python function
// (amendment 1 revision, e2aa89f). Every URL has already passed safeFetch's
// allowlist/SSRF check in the caller before it reaches this client -- this
// file only builds the internal request, enforces a timeout, and validates
// the function's response shape before it becomes trustworthy data.

const DEFAULT_TIMEOUT_MS = 15_000;

export class AgentReachTimeoutError extends Error {
  constructor(message = 'Agent Reach function did not respond inside the timeout') {
    super(message);
    this.name = 'AgentReachTimeoutError';
  }
}

export class AgentReachMalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentReachMalformedResponseError';
  }
}

export type AgentReachChannel = 'web' | 'rss' | 'youtube';

export interface AgentReachChannelRequest {
  channel: AgentReachChannel;
  url: string;
}

export interface AgentReachChannelResult {
  canonicalUrl: string;
  title: string | null;
  publishedAt: Date | null;
  excerpt: string;
  sourceType: 'news' | 'blog' | 'press_release' | 'product_page' | 'pricing_page' | 'other';
  agentReachVersion: string;
  /** Only ever set by the youtube channel -- whether captions (not just the description)
   * contributed to `excerpt`. Absent for every other channel. */
  hasCaptions?: boolean;
}

export interface AgentReachVideoListItem {
  id: string;
  title: string | null;
  publishedAt: Date | null;
}

function internalBaseUrl(): string {
  const override = process.env.AGENT_REACH_BASE_URL;
  if (override) return override;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

const SOURCE_TYPES = new Set(['news', 'blog', 'press_release', 'product_page', 'pricing_page', 'other']);

function validateShape(body: unknown): AgentReachChannelResult {
  if (typeof body !== 'object' || body === null) {
    throw new AgentReachMalformedResponseError('Agent Reach response was not a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.canonicalUrl !== 'string' || b.canonicalUrl.length === 0) {
    throw new AgentReachMalformedResponseError('Agent Reach response missing canonicalUrl');
  }
  if (b.title !== null && typeof b.title !== 'string') {
    throw new AgentReachMalformedResponseError('Agent Reach response title must be string or null');
  }
  if (typeof b.excerpt !== 'string') {
    throw new AgentReachMalformedResponseError('Agent Reach response excerpt must be a string');
  }
  if (typeof b.sourceType !== 'string' || !SOURCE_TYPES.has(b.sourceType)) {
    throw new AgentReachMalformedResponseError('Agent Reach response sourceType is missing or not a recognized value');
  }
  if (typeof b.agentReachVersion !== 'string' || b.agentReachVersion.length === 0) {
    throw new AgentReachMalformedResponseError('Agent Reach response missing agentReachVersion');
  }
  let publishedAt: Date | null = null;
  if (b.publishedAt !== null) {
    if (typeof b.publishedAt !== 'string') {
      throw new AgentReachMalformedResponseError('Agent Reach response publishedAt must be a string or null');
    }
    const parsed = new Date(b.publishedAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new AgentReachMalformedResponseError('Agent Reach response publishedAt is not a valid date');
    }
    publishedAt = parsed;
  }
  if (b.hasCaptions !== undefined && typeof b.hasCaptions !== 'boolean') {
    throw new AgentReachMalformedResponseError('Agent Reach response hasCaptions must be a boolean when present');
  }
  return {
    canonicalUrl: b.canonicalUrl,
    title: b.title as string | null,
    publishedAt,
    excerpt: b.excerpt, // untrusted data -- passed through unchanged, never interpreted
    sourceType: b.sourceType as AgentReachChannelResult['sourceType'],
    agentReachVersion: b.agentReachVersion,
    hasCaptions: b.hasCaptions as boolean | undefined,
  };
}

function validateVideoListShape(body: unknown): AgentReachVideoListItem[] {
  if (typeof body !== 'object' || body === null) {
    throw new AgentReachMalformedResponseError('Agent Reach list response was not a JSON object');
  }
  const videos = (body as Record<string, unknown>).videos;
  if (!Array.isArray(videos)) {
    throw new AgentReachMalformedResponseError('Agent Reach list response missing a videos array');
  }
  return videos.map((v) => {
    if (typeof v !== 'object' || v === null) {
      throw new AgentReachMalformedResponseError('Agent Reach list response contained a non-object video entry');
    }
    const entry = v as Record<string, unknown>;
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new AgentReachMalformedResponseError('Agent Reach list response video entry missing id');
    }
    if (entry.title !== null && typeof entry.title !== 'string') {
      throw new AgentReachMalformedResponseError('Agent Reach list response video title must be string or null');
    }
    let publishedAt: Date | null = null;
    if (entry.publishedAt !== null) {
      if (typeof entry.publishedAt !== 'string') {
        throw new AgentReachMalformedResponseError('Agent Reach list response video publishedAt must be a string or null');
      }
      const parsed = new Date(entry.publishedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new AgentReachMalformedResponseError('Agent Reach list response video publishedAt is not a valid date');
      }
      publishedAt = parsed;
    }
    return { id: entry.id, title: entry.title as string | null, publishedAt };
  });
}

async function postToAgentReach(requestBody: Record<string, unknown>, opts: { timeoutMs?: number }): Promise<unknown> {
  const secret = process.env.AGENT_REACH_INTERNAL_SECRET;
  if (!secret) {
    throw new Error('AGENT_REACH_INTERNAL_SECRET is not configured');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${internalBaseUrl()}/api/research/agent-reach`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-reach-secret': secret,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new AgentReachMalformedResponseError(`Agent Reach function returned status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AgentReachTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callAgentReach(
  request: AgentReachChannelRequest,
  opts: { timeoutMs?: number } = {},
): Promise<AgentReachChannelResult> {
  const body = await postToAgentReach({ ...request }, opts);
  return validateShape(body);
}

// List mode is only meaningful for the 'youtube' channel (Task 23) -- the function's
// contract otherwise always returns a single document (see agent-reach.py's module docstring).
export async function callAgentReachVideoList(
  channelUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<AgentReachVideoListItem[]> {
  const body = await postToAgentReach({ channel: 'youtube', url: channelUrl, mode: 'list' }, opts);
  return validateVideoListShape(body);
}
