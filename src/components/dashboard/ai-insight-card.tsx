import { Sparkle } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent } from '@/components/ui/card';

export function AiInsightCard({ summary }: { summary: string }) {
  return (
    <Card className="border-accent/20 bg-accent/5">
      <CardContent className="flex items-start gap-3 p-4">
        <Sparkle size={18} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-accent">AI summary</span>
          <p className="mt-1 text-sm text-foreground">{summary}</p>
        </div>
      </CardContent>
    </Card>
  );
}
