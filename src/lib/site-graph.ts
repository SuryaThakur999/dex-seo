export interface SiteGraphNode {
  url: string;
  label: string;
  // In+out degree within this scan's edge set only -- a real, observable connectivity count,
  // not a crawl-depth or importance score (no such measure exists anywhere in this codebase).
  linkCount: number;
}

export interface SiteGraphEdge {
  from: string;
  to: string;
}

export interface SiteGraph {
  nodes: SiteGraphNode[];
  edges: SiteGraphEdge[];
}

// A page reached as "https://site.com" and "https://site.com/" is the same page -- without
// this, the homepage could appear as two separate nodes ("Home" and a stray "/") depending on
// which exact URL string happened to be recorded as a link's source or target.
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return url;
  }
}

function shortLabel(url: string, homepageUrl: string): string {
  try {
    const u = new URL(url);
    if (url === homepageUrl) return 'Home';
    const path = u.pathname.replace(/\/$/, '') || '/';
    return path.length > 24 ? `${path.slice(0, 23)}…` : path;
  } catch {
    return url;
  }
}

// Real degree-based subgraph, not a fabricated crawl map: homepage is always included (it's
// the one node every scan reliably touches), the remaining slots go to whichever other URLs
// actually appear most often as a link source or target within this scan's real edges, and an
// edge only survives into the output if BOTH its endpoints made the cut -- no dangling lines
// to a node the caller never sees.
export function computeSiteGraph(links: { fromUrl: string; toUrl: string }[], homepageUrl: string, maxNodes = 10): SiteGraph {
  if (links.length === 0) return { nodes: [], edges: [] };

  const homepage = normalizeUrl(homepageUrl);
  const normalizedLinks = links.map((link) => ({ fromUrl: normalizeUrl(link.fromUrl), toUrl: normalizeUrl(link.toUrl) }));

  const degree = new Map<string, number>();
  const bump = (url: string) => degree.set(url, (degree.get(url) ?? 0) + 1);
  for (const link of normalizedLinks) {
    bump(link.fromUrl);
    bump(link.toUrl);
  }

  const ranked = [...degree.keys()]
    .filter((url) => url !== homepage)
    .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));

  const includedUrls = new Set<string>([homepage, ...ranked.slice(0, Math.max(0, maxNodes - 1))]);

  const nodes: SiteGraphNode[] = [...includedUrls].map((url) => ({
    url,
    label: shortLabel(url, homepage),
    linkCount: degree.get(url) ?? 0,
  }));

  const seenEdges = new Set<string>();
  const edges: SiteGraphEdge[] = [];
  for (const link of normalizedLinks) {
    if (!includedUrls.has(link.fromUrl) || !includedUrls.has(link.toUrl)) continue;
    if (link.fromUrl === link.toUrl) continue;
    const key = `${link.fromUrl}→${link.toUrl}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from: link.fromUrl, to: link.toUrl });
  }

  return { nodes, edges };
}
