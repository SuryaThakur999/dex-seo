import React from 'react';

// A brand-new workspace is created on the sentinel itself, so there is no customer-typed host
// to echo back; only a legacy pending row has one worth showing.
export function PendingUrlCopy({ normalizedHost, hostIsSentinel }: { normalizedHost: string; hostIsSentinel: boolean }) {
  return (
    <p className="text-sm text-foreground">
      {hostIsSentinel ? (
        <>Enter your website&apos;s URL to start auditing it. No Google account needed.</>
      ) : (
        <>
          Confirm this website&apos;s URL to start auditing it — we have{' '}
          <span className="font-mono">{normalizedHost}</span> from when it was added.
        </>
      )}
    </p>
  );
}
