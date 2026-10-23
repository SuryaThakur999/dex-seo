import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/content-studio/platform-icon';
import { suggestChannelsForAction } from '@/lib/content-studio/suggest-channels';

export interface SeoFinding {
  id: string;
  pageUrl: string;
  ruleId: string;
  severity: 'low' | 'medium' | 'high';
  suggestedAction: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string | null;
}

// Labels the rules the SEO Specialist actually produces (brief section 5) — anything
// unrecognized falls back to its raw ruleId rather than a made-up name.
export const RULE_LABEL: Record<string, string> = {
  missing_canonical: 'Missing canonical',
  invalid_canonical: 'Invalid canonical',
  canonical_points_elsewhere: 'Canonical points elsewhere',
  missing_structured_data: 'Missing structured data',
  zero_internal_links: 'No internal links',
  ai_crawlers_blocked: 'AI crawlers blocked',
  missing_entity_markup: 'Missing entity markup',
  unverified_claim_candidate: 'Unverified claim',
  broken_page_status: 'Broken page',
};

const SEVERITY_VARIANT: Record<SeoFinding['severity'], 'destructive' | 'secondary' | 'outline'> = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
};

// Ruleid-specific — a Studio CTA must describe the actual finding, not a copy-pasted reason
// from whichever ruleId happened to add the first CTA. Only ruleIds with a real content angle
// ever reach this (see suggestChannelsForAction), but the fallback below still exists so a
// future ruleId that gains a suggestion never silently inherits another rule's wording.
const STUDIO_TOPIC_BY_RULE: Record<string, (finding: SeoFinding) => string> = {
  zero_internal_links: (f) => `Write content linking to ${f.pageUrl} — it currently has no internal links pointing to it.`,
};

function studioTopicFor(finding: SeoFinding): string {
  const build = STUDIO_TOPIC_BY_RULE[finding.ruleId];
  return build ? build(finding) : `Write content addressing this finding on ${finding.pageUrl}: ${finding.suggestedAction}`;
}

const FINDINGS_LIMIT = 6;

// Findings from the most recent scan only (see call site) — an unfixed issue reappears
// next scan with a fresh row, so scoping to the latest scanJobId avoids showing findings
// a since-completed scan already superseded.
export function SeoFindingsPanel({ findings, websiteId }: { findings: SeoFinding[]; websiteId: string }) {
  if (findings.length === 0) return null;

  const top = findings.slice(0, FINDINGS_LIMIT);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Website findings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        {top.map((finding) => {
          // Only ruleId shapes with a real content angle get a Studio CTA (see
          // suggest-channels.ts) — the rest are pure on-page markup fixes with nothing a social
          // post or article would actually address. Not every SEO issue needs a social post.
          const suggestions = suggestChannelsForAction(finding.ruleId);
          const lowConfidence = finding.confidence !== 'high';
          return (
            <div key={finding.id} className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{finding.pageUrl}</p>
                <p className="truncate text-xs text-muted-foreground">{finding.suggestedAction}</p>
                {finding.limitations && (
                  <p className="truncate text-xs text-muted-foreground italic" title={finding.limitations}>
                    {finding.limitations}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {lowConfidence && (
                  <span className="text-[10px] text-muted-foreground" title="Lower-confidence signal — worth a manual look before acting.">
                    {finding.confidence} confidence
                  </span>
                )}
                {suggestions.map((s) => (
                  <Link
                    key={s.platform}
                    href={`/studio?websiteId=${websiteId}&platform=${s.platform}&topic=${encodeURIComponent(studioTopicFor(finding))}`}
                    title={s.rationale}
                    className="rounded p-1 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PlatformIcon platform={s.platform} size={16} />
                  </Link>
                ))}
                <Badge variant={SEVERITY_VARIANT[finding.severity]}>{RULE_LABEL[finding.ruleId] ?? finding.ruleId}</Badge>
              </div>
            </div>
          );
        })}
        {findings.length > FINDINGS_LIMIT && (
          <p className="mt-1 text-xs text-muted-foreground">
            +{findings.length - FINDINGS_LIMIT} more finding{findings.length - FINDINGS_LIMIT === 1 ? '' : 's'} from this scan.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
