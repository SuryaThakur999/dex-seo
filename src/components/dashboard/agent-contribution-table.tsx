import React from 'react';
import type { CategoryCount } from '@/lib/dashboard-stats';

// The 3 real Finding-producing agents (brief section 5) — an unrecognized key falls back
// to its raw string, same convention as RULE_LABEL.
const AGENT_LABEL: Record<string, string> = {
  seo_specialist: 'Technical SEO',
  geo_specialist: 'GEO / AI discoverability',
  brand_specialist: 'Brand & content',
};

/**
 * Findings created per agent, from the most recent scan — deliberately not the mockup's
 * fuller "Jobs reviewed / Approved / Evidence" columns: Action rows (what gets reviewed and
 * approved) have no link back to the Finding or agent that produced them anywhere in this
 * schema, so those columns would be fabricated. Findings-by-agent is the real slice available.
 */
export function AgentContributionTable({ counts }: { counts: CategoryCount[] }) {
  if (counts.length === 0) {
    return <p className="text-sm text-muted-foreground">No agent findings from your most recent scan.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="pb-2 font-normal">Agent</th>
          <th className="pb-2 text-right font-normal">Findings</th>
        </tr>
      </thead>
      <tbody>
        {counts.map((c) => (
          <tr key={c.category} className="border-b border-border last:border-0">
            <td className="py-2 text-foreground">{AGENT_LABEL[c.category] ?? c.category}</td>
            <td className="py-2 text-right font-medium text-foreground">{c.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
