import { describe, it, expect } from 'vitest';
import { PlatformPreview } from './platform-preview';

// Read text from raw elements, evaluating function components such as Hashtags and ChipList.
function text(el: unknown): string {
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(text).join('');
  if (el && typeof el === 'object') {
    const node = el as { type?: unknown; props?: { children?: unknown } };
    if (typeof node.type === 'function') {
      return text((node.type as (props: unknown) => unknown)(node.props));
    }
    if (node.props) return text(node.props.children);
  }
  return '';
}

describe('PlatformPreview', () => {
  it('renders LinkedIn body and hashtags', () => {
    const el = PlatformPreview({ platform: 'linkedin', draft: { body: 'Real drafted copy.', hashtags: ['seo', 'geo'] } });
    const rendered = text(el);
    expect(rendered).toContain('Real drafted copy.');
    expect(rendered).toContain('#seo');
    expect(rendered).toContain('#geo');
  });

  it('renders Reddit title, body, and subreddit chips', () => {
    const el = PlatformPreview({
      platform: 'reddit',
      draft: { title: 'A real title', body: 'A real body', suggestedSubreddits: ['smallbusiness'] },
    });
    const rendered = text(el);
    expect(rendered).toContain('A real title');
    expect(rendered).toContain('A real body');
    expect(rendered).toContain('r/');
    expect(rendered).toContain('smallbusiness');
  });

  it('renders UGC brief deliverables and doNotSay lists only when non-empty', () => {
    const withLists = text(
      PlatformPreview({
        platform: 'ugc_brief',
        draft: { brief: 'Real brief text.', deliverables: ['1 unboxing clip'], doNotSay: ['guaranteed'] },
      })
    );
    expect(withLists).toContain('1 unboxing clip');
    expect(withLists).toContain('guaranteed');

    const withoutLists = text(
      PlatformPreview({ platform: 'ugc_brief', draft: { brief: 'Real brief text.', deliverables: [], doNotSay: [] } })
    );
    expect(withoutLists).not.toContain('Deliverables');
    expect(withoutLists).not.toContain('Do not say');
  });

  it('renders the real X character count against the draft body', () => {
    const rendered = text(PlatformPreview({ platform: 'x', draft: { body: 'Short post.', hashtags: [] } }));
    expect(rendered).toContain('11/280 characters');
  });

  it('renders every X thread post in order with hashtags counted on the final post', () => {
    const el = PlatformPreview({
      platform: 'x',
      draft: { body: 'Opening.', posts: ['Opening.', 'Next step.'], hashtags: ['seo'] },
    });
    const rendered = text(el);
    expect(el.type).toBe('ol');
    expect(rendered).toContain('Opening.');
    expect(rendered).toContain('Next step.');
    expect(rendered.indexOf('Opening.')).toBeLessThan(rendered.indexOf('Next step.'));
    expect(rendered).toContain('8/280 characters');
    expect(rendered).toContain('16/280 characters');
    expect(rendered.match(/#seo/g)).toHaveLength(1);
  });
});
