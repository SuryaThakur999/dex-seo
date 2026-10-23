'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { MagnifyingGlass, ArrowRight } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { CommandBarResponse } from '@/app/api/command-bar/route';
import { ThinkingOrb } from 'thinking-orbs';

export function CommandBar({ websiteId }: { websiteId: string }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CommandBarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/command-bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, websiteId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Something went wrong.');
      }
      setResponse(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Ask about this client, or type "audit" to check it again…'}
            aria-label="Command bar"
            className="h-11 w-full rounded-md border border-[var(--dex-app-border-strong)] bg-transparent pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button type="submit" variant="accent" disabled={loading || !text.trim()} className="h-11">
          {loading ? <><ThinkingOrb state="working" size={20} theme="dark" aria-hidden="true" className="mr-2" />Working…</> : 'Go'}
        </Button>
      </form>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {response && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">{response.context.websiteUrl}</span>
            <span className="text-xs text-muted-foreground">
              {response.context.gscConnected ? 'Search Console connected' : 'Not connected'}
            </span>
          </div>
          <p className="text-foreground">{response.message}</p>
          {response.actions.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {response.actions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
                >
                  {action.label}
                  <ArrowRight size={12} weight="bold" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
