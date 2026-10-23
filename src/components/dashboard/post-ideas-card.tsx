import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface PostIdea {
  id: string;
  topic: string;
  whyNow: string;
  sourceDate: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function PostIdeasCard({ websiteId, ideas }: { websiteId: string; ideas: PostIdea[] }) {
  const top = ideas.slice(0, 3);

  return (
    <Card role="region" aria-label="Post ideas">
      <CardHeader>
        <CardTitle className="text-base font-medium">Post ideas</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">No post ideas yet. Dex surfaces these as it finds real opportunities.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {top.map((idea) => (
              <li key={idea.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{idea.topic}</span>
                  <time dateTime={idea.sourceDate} className="text-xs text-muted-foreground">{dateFormatter.format(new Date(idea.sourceDate))}</time>
                </div>
                <p className="text-sm text-muted-foreground">{idea.whyNow}</p>
                <a
                  href={`/studio?websiteId=${encodeURIComponent(websiteId)}&topic=${encodeURIComponent(idea.topic)}&sourceRecommendationId=${encodeURIComponent(idea.id)}`}
                  className="mt-1 w-fit text-xs font-medium text-accent underline-offset-4 hover:underline"
                >
                  Write post
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
