import { describe, it, expect } from 'vitest';
import { computeGscConnectionState } from './gsc-connection-state';

describe('computeGscConnectionState', () => {
  it('is not_connected when no token is stored', () => {
    const state = computeGscConnectionState({ gscRefreshToken: null, gscReconnectRequired: false, gscPropertyUrl: null });
    expect(state).toBe('not_connected');
  });

  it('is property_pending when a token is stored but no property has been selected yet', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'token',
      gscReconnectRequired: false,
      gscPropertyUrl: null,
    });
    expect(state).toBe('property_pending');
  });

  it('is reconnect_required when Google has flagged the stored token dead, even mid property-selection', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'dead-token',
      gscReconnectRequired: true,
      gscPropertyUrl: null,
    });
    expect(state).toBe('reconnect_required');
  });

  it('is connected when a token is stored, not flagged, and a real property is selected', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'token',
      gscReconnectRequired: false,
      gscPropertyUrl: 'https://acme.com',
    });
    expect(state).toBe('connected');
  });

  it('is reconnect_required, not connected, when a flagged token happens to have a resolved property', () => {
    const state = computeGscConnectionState({
      gscRefreshToken: 'dead-token',
      gscReconnectRequired: true,
      gscPropertyUrl: 'https://acme.com',
    });
    expect(state).toBe('reconnect_required');
  });
});
