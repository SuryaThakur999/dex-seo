import { describe, it, expect } from 'vitest';
import { checkPlatformPolicy } from './policy-rules';

describe('checkPlatformPolicy', () => {
  it('returns null for a platform with no policy rule (no forced check)', () => {
    expect(checkPlatformPolicy('linkedin', { text: 'hello' })).toBeNull();
  });

  it('fails a Reddit draft with no suggested subreddits', () => {
    const result = checkPlatformPolicy('reddit', { title: 't', body: 'b', suggestedSubreddits: [] });
    expect(result?.result).toBe('fail');
  });

  it('fails a Reddit draft missing the field entirely', () => {
    const result = checkPlatformPolicy('reddit', { title: 't', body: 'b' });
    expect(result?.result).toBe('fail');
  });

  it('passes a Reddit draft with at least one suggested subreddit', () => {
    const result = checkPlatformPolicy('reddit', { title: 't', body: 'b', suggestedSubreddits: ['r/smallbusiness'] });
    expect(result?.result).toBe('pass');
  });
});
