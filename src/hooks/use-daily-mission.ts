import { useEffect, useState } from 'react';
import type { Mission } from '@/lib/daily-mission-logic';

export function useDailyMission(websiteId: string): { mission: Mission | null; error: boolean } {
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setMission(null);
    setError(false);

    async function load() {
      try {
        const response = await fetch(`/api/dashboard/daily-mission?websiteId=${encodeURIComponent(websiteId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Daily mission request failed');
        const data: Mission = await response.json();
        if (!disposed) setMission(data);
      } catch {
        if (!disposed) setError(true);
      }
    }

    void load();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [websiteId]);

  return { mission, error };
}
