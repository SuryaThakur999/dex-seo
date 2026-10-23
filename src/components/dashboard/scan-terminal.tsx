'use client';

import { useEffect, useRef, useState } from 'react';
import { friendlyLogMessage } from '@/lib/friendly-log-message';

const NEAR_BOTTOM_PX = 40;

export function ScanTerminal({
  lines,
  running,
}: {
  lines: { id: string; message: string; createdAt: string }[];
  running: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(lines.length);
  const [newActivity, setNewActivity] = useState(false);
  // DEX CONTINUATION MASTER DIRECTIVE Phase 3: "Use friendly narration by default. Provide
  // 'Expand technical report' for..." — the stored message IS the technical detail (real
  // URLs, real counts); "technical" here means showing that raw text instead of the
  // friendly rewrite, not a separate report with fields never actually captured per line.
  const [showTechnical, setShowTechnical] = useState(false);

  // Only auto-scroll when the reader is already at the bottom — otherwise flag
  // "New activity" instead of yanking their scroll position mid-read.
  useEffect(() => {
    const el = containerRef.current;
    const grew = lines.length > prevCountRef.current;
    prevCountRef.current = lines.length;
    if (!el || !grew) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    } else {
      setNewActivity(true);
    }
  }, [lines]);

  if (lines.length === 0) return null;

  function scrollToBottom() {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewActivity(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowTechnical((v) => !v)}
          className="text-[10px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {showTechnical ? 'Show friendly view' : 'Expand technical report'}
        </button>
      </div>
      <div
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) setNewActivity(false);
        }}
        className="max-h-64 overflow-y-auto rounded-md border border-border bg-[var(--dex-app-bg-elevated-2)] px-4 py-3 font-mono text-xs text-foreground"
      >
        {lines.map((line, i) => (
          <div key={line.id} className="flex gap-2 leading-relaxed">
            <span className="shrink-0 text-muted-foreground" aria-hidden="true">
              {i === 0 ? '$' : '>'}
            </span>
            <time
              dateTime={line.createdAt}
              title={new Date(line.createdAt).toLocaleString()}
              className="shrink-0 text-muted-foreground"
            >
              {new Date(line.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </time>
            <span>{showTechnical ? line.message : friendlyLogMessage(line.message)}</span>
          </div>
        ))}
        {running && (
          <span
            className="mt-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
      </div>
      {newActivity && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="self-center rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          New activity
        </button>
      )}
    </div>
  );
}
