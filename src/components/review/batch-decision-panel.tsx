'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BatchPreview, BatchRequest } from '@/lib/action-batch';

export type ReviewBatchPreview = BatchPreview & {
  policyVersion: string;
  aiDisclosure: boolean;
  reasoning: string;
  checks: { check: string; detail: string; result: string }[];
};
const control = 'inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function BatchDecisionPanel({ preview }: { preview: ReviewBatchPreview }) {
  const router = useRouter();
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const request = useRef<BatchRequest | null>(null);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const approveControl = useRef<HTMLButtonElement>(null);
  const rejectControl = useRef<HTMLButtonElement>(null);
  const cancelledDecision = useRef<'approve' | 'reject' | null>(null);
  const count = preview.items.length;
  useEffect(() => {
    if (cancelledDecision.current) {
      (cancelledDecision.current === 'approve' ? approveControl : rejectControl).current?.focus();
      cancelledDecision.current = null;
    } else feedback.current?.focus();
  }, [decision, saved, error]);

  async function submit() {
    if (!decision || inFlight.current || invalid || saved) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      request.current ??= {
        requestId: crypto.randomUUID(), websiteId: preview.websiteId, decision,
        items: preview.items.map(({ actionId, revision }) => ({ actionId, revision })),
      };
      const response = await fetch('/api/actions/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.current),
      });
      if (!response.ok) {
        if (response.status === 409 || response.status === 400 || response.status === 404) {
          setInvalid(true);
          setError('These changes are no longer available as this batch. Reload the queue to review the current versions.');
        } else {
          setError('Could not confirm the result. Retry this same decision to check it safely.');
        }
        return;
      }
      setSaved(true);
    } catch {
      setError('Could not confirm the result. Retry this same decision to check it safely.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <section aria-label={`Batch of ${count} matching site changes`} className="mt-6 min-w-0 rounded-lg border border-border p-4 sm:p-6">
    <h3 className="text-base font-semibold text-foreground">Review {count} matching changes together</h3>
    <p className="mt-2 text-sm text-muted-foreground">Same before and after, same passed checks. Your decision covers every page listed below. Approval does not publish.</p>
    <ul className="mt-3 list-inside list-disc space-y-1 break-all text-sm text-foreground">
      {preview.items.map(item => <li key={item.actionId}>{item.pageUrl}</li>)}
    </ul>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div><h4 className="text-sm font-medium">Before</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{preview.sharedCurrentValue ?? 'No existing value'}</p></div>
      <div><h4 className="text-sm font-medium">After</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{preview.sharedDraftContent}</p></div>
    </div>
    <p className="mt-4 text-sm text-muted-foreground">Low risk · Policy {preview.policyVersion} · AI disclosure {preview.aiDisclosure ? 'included' : 'not included'}</p>
    <p className="mt-2 text-sm text-foreground">{preview.reasoning}</p>
    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{preview.checks.map((check, index) => <li key={index}>{check.check}: {check.detail} ({check.result})</li>)}</ul>
    {error && <p ref={feedback} tabIndex={-1} role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {saved ? <div className="mt-4">
      <p ref={feedback} tabIndex={-1} role="status" className="text-sm text-foreground">{count} {decision === 'approve' ? 'approvals' : 'rejections'} saved. Nothing was applied to your website.</p>
      <p className="mt-2 text-sm text-muted-foreground">Open an individual decision to view its receipt or undo it.</p>
      <ul className="mt-2 space-y-1">{preview.items.map((item, index) => <li key={item.actionId}><Link className={control + ' break-all underline'} href={`/review/${encodeURIComponent(item.actionId)}`}>View decision {index + 1}</Link></li>)}</ul>
      <button className={control + ' mt-4'} onClick={() => router.refresh()}>Reload queue</button>
    </div> : invalid ? <button className={control + ' mt-4'} onClick={() => router.refresh()}>Reload queue</button> : decision ? <div className="mt-4">
      <p ref={error ? undefined : feedback} tabIndex={-1} className="text-sm text-foreground">{decision === 'approve' ? 'Approve' : 'Reject'} all {count} changes? No changes will be published.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={control} disabled={pending} onClick={submit}>{pending ? 'Saving decision…' : `Confirm ${decision === 'approve' ? 'approval' : 'rejection'} of ${count} changes`}</button>
        {!request.current && <button className={control} disabled={pending} onClick={() => { cancelledDecision.current = decision; setDecision(null); }}>Cancel</button>}
      </div>
    </div> : <div className="mt-4 flex flex-wrap gap-2">
      <button ref={approveControl} className={control} onClick={() => setDecision('approve')}>Approve these {count} changes</button>
      <button ref={rejectControl} className={control} onClick={() => setDecision('reject')}>Reject these {count} changes</button>
    </div>}
  </section>;
}
