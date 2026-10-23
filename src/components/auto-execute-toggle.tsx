'use client';

import { useState, useTransition } from 'react';
import { Switch } from '@/components/ui/switch';

export function AutoExecuteToggle({ initialEnabled, websiteId }: { initialEnabled: boolean; websiteId: string }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(checked: boolean) {
    setError(null);
    setEnabled(checked);
    startTransition(async () => {
      const res = await fetch('/api/settings/auto-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: checked, websiteId }),
      });
      if (!res.ok) {
        setEnabled(!checked);
        setError('Could not update this setting. Try again.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Switch checked={enabled} onCheckedChange={handleChange} disabled={isPending} aria-label="Auto-execute toggle" />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
