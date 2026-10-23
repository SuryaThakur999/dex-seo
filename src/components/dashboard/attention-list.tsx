import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OUTCOME_LABEL, OUTCOME_VARIANT } from '@/lib/guard-outcome-ui';
import { formatRelativeTime } from '@/lib/dashboard-stats';
import { PlatformIcon } from '@/components/content-studio/platform-icon';
import { suggestChannelsForAction } from '@/lib/content-studio/suggest-channels';

export interface AttentionAction {
  id: string;
  pageUrl: string;
  createdAt: Date;
  guardResult: { outcome: string } | null;
  actionType: string;
  websiteId: string;
  generationStatus: string;
}

const ATTENTION_LIMIT = 5;

export function AttentionList({ actions }: { actions: AttentionAction[] }) {
  const top = actions.slice(0, ATTENTION_LIMIT);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Needs your attention</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        {top.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending review.</p>}
        {top.map((action) => {
          const suggestions = suggestChannelsForAction(action.actionType);
          return (
            <div
              key={action.id}
              className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
            >
              <Link
                href={`?tab=review&actionId=${action.id}`}
                scroll={false}
                className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="truncate text-sm text-foreground">{action.pageUrl}</p>
                <p className="text-xs text-muted-foreground">{formatRelativeTime(action.createdAt)}</p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {suggestions.length > 0 &&
                  suggestions.map((s) => (
                    <Link
                      key={s.platform}
                      href={`/studio?websiteId=${action.websiteId}&actionId=${action.id}&platform=${s.platform}`}
                      title={s.rationale}
                      className="rounded p-1 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PlatformIcon platform={s.platform} size={16} />
                    </Link>
                  ))}
                {suggestions.length === 0 && (
                  // No specific platform fits this finding's actionType yet — still route to
                  // Studio rather than dead-ending, so every finding stays actionable.
                  <Link
                    href={`/studio?websiteId=${action.websiteId}&actionId=${action.id}`}
                    className="text-xs font-medium text-accent underline-offset-4 hover:underline"
                  >
                    Open in Studio
                  </Link>
                )}
                {action.guardResult && (
                  <Badge variant={OUTCOME_VARIANT[action.guardResult.outcome] ?? 'secondary'}>
                    {OUTCOME_LABEL[action.guardResult.outcome] ?? action.guardResult.outcome}
                  </Badge>
                )}
                {!action.guardResult && action.generationStatus === 'failed' && (
                  <Badge variant="destructive">Draft failed</Badge>
                )}
              </div>
            </div>
          );
        })}
        {actions.length > ATTENTION_LIMIT && (
          <Link
            href="?tab=review"
            scroll={false}
            className="mt-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            View all {actions.length} in Review Queue &rarr;
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
