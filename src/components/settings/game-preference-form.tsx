'use client';

import { useState, useTransition } from 'react';
import type { GamePreference } from '@prisma/client';
import { cn } from '@/lib/utils';

const OPTIONS: { value: GamePreference; label: string; description: string }[] = [
  { value: 'ask', label: 'Ask during each scan', description: 'Show the option after every audit (default).' },
  { value: 'always_watch', label: 'Always show scan activity', description: 'Go straight to the live terminal, every time.' },
  { value: 'always_game', label: 'Always offer Crawl Runner', description: 'Open the game automatically on longer audits.' },
  { value: 'disabled', label: 'Disable playful mode', description: 'Never show or offer Crawl Runner for this workspace.' },
];

// Real, workspace-wide setting (Customer.gamePreference) — 'disabled' here is the literal
// enterprise disable control the directive asks for; no separate plan gate exists to attach
// a duplicate toggle to.
export function GamePreferenceForm({ initial }: { initial: GamePreference }) {
  const [value, setValue] = useState<GamePreference>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: GamePreference) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/settings/game-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gamePreference: next }),
      });
      if (!res.ok) {
        setValue(previous);
        setError('Could not save this preference. Try again.');
      }
    });
  }

  return (
    <div role="radiogroup" aria-label="Scan experience" className="flex flex-col gap-2">
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => handleChange(option.value)}
            disabled={isPending}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors',
              active ? 'border-accent bg-muted' : 'border-border hover:bg-muted'
            )}
          >
            <span className="text-sm font-medium text-foreground">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </button>
        );
      })}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
