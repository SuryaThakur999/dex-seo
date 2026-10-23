import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandBar } from './command-bar';

describe('CommandBar', () => {
  afterEach(cleanup);

  it('does not invite pasting a website URL (dashboard audit item 4: the add-site input is website-entry-panel only)', () => {
    render(<CommandBar websiteId="site_1" />);
    const input = screen.getByLabelText('Command bar');
    expect(input).toHaveAttribute('placeholder', expect.not.stringContaining('website'));
    expect(input).not.toHaveAttribute('type', 'url');
  });

  it('still invites asking about the client or re-running an audit', () => {
    render(<CommandBar websiteId="site_1" />);
    const input = screen.getByLabelText('Command bar');
    expect(input.getAttribute('placeholder')).toContain('audit');
  });
});
