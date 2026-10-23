import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { MarketingMemoryField, MarketingMemorySnapshot } from '@/lib/marketing-memory';

const FIELD_LABELS: Record<MarketingMemoryField, string> = {
  businessDescription: 'Business description',
  audience: 'Audience',
  brandVoice: 'Brand voice',
  markets: 'Markets',
  languages: 'Languages',
  approvedClaims: 'Approved claims',
  restrictedWording: 'Restricted wording',
};

export function MarketingMemoryPanel({ memory }: { memory: MarketingMemorySnapshot }) {
  return (
    <Card className="mt-6" role="region" aria-label="Marketing Memory">
      <CardHeader>
        <CardTitle><h2>Marketing Memory</h2></CardTitle>
        <CardDescription>
          {memory.facts.length === 0
            ? 'No brand facts recorded yet. Add them below.'
            : 'Current client-profile facts and matching active-preference records.'}
        </CardDescription>
      </CardHeader>
      {memory.facts.length > 0 && (
        <CardContent>
          <ul aria-label="Recorded brand facts" className="flex flex-col gap-3">
            {memory.facts.map((fact, i) => (
              <li key={`${fact.field}-${i}`} className="flex min-w-0 flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="text-sm font-medium text-foreground">{FIELD_LABELS[fact.field]}</span>
                  <span className="min-w-0 break-words text-xs text-muted-foreground sm:text-right">
                    {fact.source === 'activated_preference_match'
                      ? `matches activated preference${fact.evaluatorVersion ? ` · evaluator ${fact.evaluatorVersion}` : ''}`
                      : 'client profile field'}
                  </span>
                </div>
                <span className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground sm:text-sm">{fact.value}</span>
                <span className="text-xs text-muted-foreground">applies to all websites on this client profile</span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
