'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function ActivationToggle({ candidateId, initialActive }: { candidateId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const action = active ? 'deactivate' : 'activate';
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/preference-candidates/${candidateId}/activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setError('Could not update this preference. Try again.');
        return;
      }
      const body = await res.json();
      setActive(body.isActive);
    } catch {
      setError('Could not update this preference. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant={active ? 'outline' : 'accent'} onClick={handleClick} disabled={pending}>
        {active ? 'Active — Stop using' : 'Start using'}
      </Button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
