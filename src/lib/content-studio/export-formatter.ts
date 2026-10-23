import type { ContentPlatform } from '@prisma/client';
import { getAdapter } from './registry';

/**
 * Adapters assume a well-formed draft of their own shape. A stored
 * draftContent can legitimately not have that shape (a `failed` piece is
 * persisted with `{}`, and a hand-edited piece can be anything), so a shape
 * mismatch degrades to raw JSON rather than throwing out of the export route.
 */
export function formatContentExport(platform: ContentPlatform, draftContent: unknown): string {
  const adapter = getAdapter(platform);
  try {
    return adapter.formatExport(draftContent as never);
  } catch {
    return JSON.stringify(draftContent, null, 2);
  }
}
