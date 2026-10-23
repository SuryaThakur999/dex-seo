import type { SiteGraph } from '@/lib/site-graph';

const SIZE = 280;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 40;
const MIN_NODE_R = 5;
const MAX_NODE_R = 14;

function nodeRadius(linkCount: number, maxLinkCount: number): number {
  if (maxLinkCount === 0) return MIN_NODE_R;
  return MIN_NODE_R + (MAX_NODE_R - MIN_NODE_R) * (linkCount / maxLinkCount);
}

/**
 * Real internal-link structure from the latest scan's PageLink edges -- the homepage sits at
 * center (the one node every scan reliably touches), the rest are placed evenly around it in
 * a circle, sized by real observed link count. A deterministic layout, not a physics
 * simulation: no new graph/force library, and stable across renders for the same data.
 */
export function SiteGraphChart({ graph, homepageUrl }: { graph: SiteGraph; homepageUrl: string }) {
  if (graph.nodes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No page-link data yet — run a scan to map how your pages connect.
      </p>
    );
  }

  const others = graph.nodes.filter((n) => n.url !== homepageUrl);
  const maxLinkCount = Math.max(1, ...graph.nodes.map((n) => n.linkCount));
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(homepageUrl, { x: CENTER, y: CENTER });
  others.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, others.length) - Math.PI / 2;
    positions.set(node.url, { x: CENTER + RADIUS * Math.cos(angle), y: CENTER + RADIUS * Math.sin(angle) });
  });

  return (
    <div role="img" aria-label={`Site link graph: ${graph.nodes.length} pages, ${graph.edges.length} internal links`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" style={{ maxHeight: 280 }}>
        {graph.edges.map((edge, i) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={i}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--border)"
              strokeWidth={1}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const pos = positions.get(node.url);
          if (!pos) return null;
          const isHome = node.url === homepageUrl;
          return (
            <g key={node.url}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius(node.linkCount, maxLinkCount)}
                fill={isHome ? 'var(--accent)' : 'var(--dex-app-warning, #ffb020)'}
                opacity={isHome ? 1 : 0.85}
              />
              <text
                x={pos.x}
                y={pos.y + nodeRadius(node.linkCount, maxLinkCount) + 12}
                textAnchor="middle"
                fontSize={9}
                fill="var(--muted-foreground)"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
