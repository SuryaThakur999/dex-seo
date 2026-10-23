import React from 'react';
import type { ReceiptView } from '@/lib/proof-receipt';

export function ProofReceipt({ receipt, currentStatus }: { receipt: ReceiptView; currentStatus: string }) {
  const snapshot = receipt.snapshot;
  const record = snapshot ?? receipt.currentRecord;
  const content = snapshot ? snapshot.decidedContent : receipt.currentRecord.draftContent;
  const metricsLabel = receipt.outcome.availability === 'observed_rows'
    ? 'Observed GSC rows'
    : receipt.outcome.availability === 'historical_unqualified'
      ? 'Historical values; row availability was not recorded'
      : 'GSC row availability unavailable';

  return (
    <section aria-label="Decision receipt" className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Decision receipt</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {receipt.basis === 'saved_snapshot' ? 'Saved when the decision was made' : 'No decision saved yet'}
      </p>
      <p className="mt-2 text-sm">Dex can&apos;t show exactly which version of the text these checks ran on.</p>
      {(currentStatus === 'edited' || snapshot?.decision === 'edited') && (
        <p className="mt-2 text-sm">Edited content was not rechecked.</p>
      )}
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Show receipt details</summary>
        <div className="space-y-4 pt-2 text-sm">
          <dl className="space-y-2">
            <div><dt className="text-muted-foreground">Page</dt><dd className="break-all">{record.pageUrl}</dd></div>
            <div><dt className="text-muted-foreground">Risk / policy</dt><dd>{record.riskTier} / {record.policyVersion}</dd></div>
            {snapshot && <div><dt className="text-muted-foreground">Decision recorded</dt><dd>{snapshot.decision} at {snapshot.decidedAt}</dd></div>}
          </dl>
          {snapshot?.decision === 'edited' && <div><h3 className="font-medium">Original draft at decision</h3><pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{snapshot.preDecisionDraftContent}</pre></div>}
          <div><h3 className="font-medium">{snapshot ? 'Decided content' : 'Current draft'}</h3><pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{content}</pre></div>
          <div>
            <h3 className="font-medium">Recorded checks</h3>
            {record.guard ? <>
              <p>{record.guard.outcome}: {record.guard.reasoning}</p>
              <ul className="mt-2 space-y-2">{record.guard.checksRun.map((check, index) => (
                <li key={`${check.check}-${index}`} className="break-words"><span className="font-medium">{check.check}: {check.result}</span><p>{check.detail}</p></li>
              ))}</ul>
            </> : <p>No recorded checks available.</p>}
          </div>
          <div><h3 className="font-medium">Search measurement</h3><p>{metricsLabel}</p>
            {receipt.outcome.availability !== 'unavailable' && <>
              <p className="mt-2">Baseline{receipt.outcome.baselineCapturedAt ? ` (${receipt.outcome.baselineCapturedAt})` : ''}</p>
              <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(receipt.outcome.baseline, null, 2)}</pre>
              <p className="mt-2">Follow-up{receipt.outcome.measuredAt ? ` (${receipt.outcome.measuredAt})` : ''}</p>
              <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(receipt.outcome.measured, null, 2)}</pre>
            </>}
          </div>
          <div><h3 className="font-medium">History</h3>
            {receipt.events.length ? <ol className="space-y-1">{receipt.events.map(event => <li key={event.id}>{event.createdAt}: {event.eventType}</li>)}</ol> : <p>No decision events recorded.</p>}
          </div>
          {receipt.limitations.length > 0 && <ul aria-label="Receipt limitations" className="list-disc space-y-1 pl-5">{receipt.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}
          <p className="text-muted-foreground">Decisions do not change your website. Apply approved changes manually.</p>
        </div>
      </details>
    </section>
  );
}
