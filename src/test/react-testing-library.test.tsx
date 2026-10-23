import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

it('renders a React element into the document', () => {
  render(<p>Harness ready</p>);

  expect(screen.getByText('Harness ready')).toBeInTheDocument();
});
