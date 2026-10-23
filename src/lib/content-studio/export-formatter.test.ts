import { describe, it, expect } from 'vitest';
import { formatContentExport } from './export-formatter';

describe('formatContentExport', () => {
  it('dispatches to the LinkedIn adapter for a linkedin draft', () => {
    const text = formatContentExport('linkedin', { body: 'A fine post.', hashtags: ['sale'] });
    expect(text).toBe('A fine post.\n\n#sale');
  });

  it('dispatches to the Reddit adapter for a reddit draft', () => {
    const text = formatContentExport('reddit', { title: 'Our sale', body: 'Details.', suggestedSubreddits: [] });
    expect(text).toBe('Title: Our sale\n\nDetails.');
  });

  it('degrades to raw JSON when the adapter throws on a shape it does not recognize', () => {
    // linkedinAdapter.formatExport reads draft.hashtags, which a failed piece's
    // persisted `{}` does not have.
    expect(() => formatContentExport('linkedin', {})).not.toThrow();
    expect(formatContentExport('linkedin', {})).toBe('{}');
  });

  it('degrades to raw JSON for a partially-shaped draft instead of propagating the error', () => {
    const text = formatContentExport('linkedin', { body: 'No hashtags key here.' });
    expect(text).toBe(JSON.stringify({ body: 'No hashtags key here.' }, null, 2));
  });
});
