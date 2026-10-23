import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { PendingUrlCopy } from './pending-url-copy';

// Same hookless-component convention as action-detail.test.tsx.
function render(props: Parameters<typeof PendingUrlCopy>[0]): string {
  return JSON.stringify(PendingUrlCopy(props) as ReactElement);
}

describe('PendingUrlCopy', () => {
  it('asks a brand-new workspace for its URL without echoing the placeholder host', () => {
    const html = render({ normalizedHost: 'example-pending-setup.com', hostIsSentinel: true });
    expect(html).toContain('No Google account needed');
    expect(html).not.toContain('example-pending-setup.com');
    expect(html).not.toContain('from when it was added');
  });

  it('shows a legacy pending row the host the customer originally typed', () => {
    const html = render({ normalizedHost: 'shop.example.de', hostIsSentinel: false });
    expect(html).toContain('shop.example.de');
    expect(html).toContain('from when it was added');
    expect(html).not.toContain('No Google account needed');
  });
});
