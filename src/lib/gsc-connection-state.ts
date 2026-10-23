export type GscConnectionState = 'not_connected' | 'reconnect_required' | 'property_pending' | 'connected';

/**
 * Classifies a site's Search Console connection from already-stored fields
 * only — no live Google call. Order matters: a dead token (reconnectRequired)
 * takes priority over a pending property selection, since selecting a
 * property against a dead token would just fail again.
 */
export function computeGscConnectionState(site: {
  gscRefreshToken: string | null;
  gscReconnectRequired: boolean;
  gscPropertyUrl: string | null;
}): GscConnectionState {
  if (!site.gscRefreshToken) return 'not_connected';
  if (site.gscReconnectRequired) return 'reconnect_required';
  if (!site.gscPropertyUrl) return 'property_pending';
  return 'connected';
}
