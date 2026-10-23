import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { OpportunityGroup } from '@/lib/opportunity-board';

/** The single real top-priority opportunity (largest real affected-page count), not a list. */
export function NextMission({ group }: { group: OpportunityGroup | null }) {
  if (!group) {
    return <p className="text-sm text-muted-foreground">Nothing open right now — run a scan to find opportunities.</p>;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium text-foreground">{group.issueLabel}</p>
        <p className="text-sm text-muted-foreground">
          {group.pageCount} page{group.pageCount === 1 ? '' : 's'} affected.
        </p>
      </div>
      <Button asChild variant="accent">
        <Link href="/review">Review drafts</Link>
      </Button>
    </div>
  );
}
